import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MIGRATION_STOPPED_KIND,
  type MigrationFocusStage,
  type MigrationIssueProgress,
  type MigrationReport,
  type SpaceMigrationFailure,
  type SpaceMigrationForm,
  type SpaceMigrationInterrupted,
  type SpaceMigrationPlanValue,
  type StepProgress,
} from '../../../../shared/ipc.js';

/**
 * Where the migration screen is.
 * `loading`: main is asked what it holds. `planning`: main makes the plan.
 * `plan`: the fields and the plan, or why there is none, wait for confirmation.
 * `running`: the steps run. `stopped`: the run was stopped before a step.
 * `failed`: a step failed. `finished`: the run reached its end.
 */
export type MigrationStage =
  | 'loading'
  | 'planning'
  | 'plan'
  | 'running'
  | 'stopped'
  | 'failed'
  | 'finished';

/** The fields the Human Lead fills. Names are core's `MigrationForm`, without the folder, which is main's. */
export type MigrationFields = {
  name: string;
  owner: string;
  description: string;
  focusStage: MigrationFocusStage | '';
  payloadGitHub: string;
  private: boolean;
};

const EMPTY_FIELDS: MigrationFields = {
  name: '',
  owner: '',
  description: '',
  focusStage: '',
  payloadGitHub: '',
  private: true,
};

const FOCUS_STAGES: readonly MigrationFocusStage[] = ['Spec', 'Plan', 'Build', 'Review', 'Done'];

/** The form main receives. It carries no folder. A blank text is left out, so that core proposes it. */
export function migrationFormOf(fields: MigrationFields): SpaceMigrationForm {
  const form: SpaceMigrationForm = { private: fields.private };
  if (fields.name.trim() !== '') form.name = fields.name;
  if (fields.owner.trim() !== '') form.owner = fields.owner;
  if (fields.description.trim() !== '') form.description = fields.description;
  if (fields.payloadGitHub.trim() !== '') form.payloadGitHub = fields.payloadGitHub;
  if (fields.focusStage !== '') form.focusStage = fields.focusStage;
  return form;
}

/** The fields as the plan was made with them: the Human Lead's values and the proposed ones. */
function fieldsOfPlan(plan: SpaceMigrationPlanValue, previous: MigrationFields): MigrationFields {
  const value = (id: string): string =>
    plan.plan.fields.find((field) => field.id === id)?.value ?? '';
  const stage = value('focusStage');
  return {
    name: value('name'),
    owner: value('owner'),
    description: value('description'),
    focusStage: FOCUS_STAGES.find((candidate) => candidate === stage) ?? '',
    payloadGitHub: value('payloadGitHub'),
    private: previous.private,
  };
}

export type MigrationFlowView = {
  stage: MigrationStage;
  fields: MigrationFields;
  setField: <K extends keyof MigrationFields>(key: K, value: MigrationFields[K]) => void;
  /** The folder chosen in main's dialog; `null` when core proposes one. */
  parentDir: string | null;
  chooseFolder: () => Promise<void>;
  /** True when a field or the folder changed after the plan was made: the plan must be made again. */
  changed: boolean;
  interrupted: SpaceMigrationInterrupted | null;
  runningElsewhere: boolean;
  makePlan: () => Promise<void>;
  plan: SpaceMigrationPlanValue | null;
  /** Why the plan could not be made. No run is offered. */
  planError: SpaceMigrationFailure | null;
  confirm: () => Promise<void>;
  stop: () => Promise<void>;
  stopping: boolean;
  runAgain: () => Promise<void>;
  /** The last progress of each step of the current run, by step id. */
  progress: Record<string, StepProgress>;
  /** The last progress of each issue of step 11 in the current run, by key. */
  issueProgress: Record<string, MigrationIssueProgress>;
  runError: SpaceMigrationFailure | null;
  report: MigrationReport | null;
  openSpace: () => Promise<void>;
  /** The message of the last request main refused, for the screen's error area. */
  error: string | null;
  busy: boolean;
};

/** The state and actions of the migration screen. Every folder and every run is main's. */
export function useMigrationFlow(): MigrationFlowView {
  const [stage, setStage] = useState<MigrationStage>('loading');
  const [fields, setFields] = useState<MigrationFields>(EMPTY_FIELDS);
  const [parentDir, setParentDir] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [interrupted, setInterrupted] = useState<SpaceMigrationInterrupted | null>(null);
  const [runningElsewhere, setRunningElsewhere] = useState(false);
  const [plan, setPlan] = useState<SpaceMigrationPlanValue | null>(null);
  const [planError, setPlanError] = useState<SpaceMigrationFailure | null>(null);
  const [progress, setProgress] = useState<Record<string, StepProgress>>({});
  const [issueProgress, setIssueProgress] = useState<Record<string, MigrationIssueProgress>>({});
  const [runError, setRunError] = useState<SpaceMigrationFailure | null>(null);
  const [report, setReport] = useState<MigrationReport | null>(null);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** True from a click on confirm until main answers, so that a double click starts one run. */
  const runStarted = useRef(false);
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;

  const requestPlan = useCallback(async (form: SpaceMigrationForm) => {
    setStage('planning');
    setError(null);
    const result = await window.cockpit.spaceMigrationPlan(form);
    if (!result.ok && result.error.kind === 'superseded') return;
    if (result.ok) {
      setPlan(result.value);
      setPlanError(null);
      setFields((previous) => fieldsOfPlan(result.value, previous));
    } else {
      setPlan(null);
      setPlanError(result.error);
    }
    setChanged(false);
    setStage('plan');
  }, []);

  useEffect(() => {
    let live = true;
    void window.cockpit.spaceMigrationState({}).then(async (result) => {
      if (!live) return;
      if (!result.ok) {
        setError(result.error.message);
        setStage('plan');
        return;
      }
      setParentDir(result.value.parentDir);
      setInterrupted(result.value.interrupted);
      setRunningElsewhere(result.value.runningElsewhere);
      if (result.value.running) {
        setStage('running');
        return;
      }
      await requestPlan(migrationFormOf(fieldsRef.current));
    });
    return () => {
      live = false;
    };
  }, [requestPlan]);

  useEffect(() => {
    const offSteps = window.cockpit.onSpaceMigrationProgress((event) => {
      setProgress((previous) => ({ ...previous, [event.stepId]: event }));
    });
    const offIssues = window.cockpit.onSpaceMigrationIssueProgress((event) => {
      setIssueProgress((previous) => ({ ...previous, [event.key]: event }));
    });
    return () => {
      offSteps();
      offIssues();
    };
  }, []);

  const setField = useCallback(
    <K extends keyof MigrationFields>(key: K, value: MigrationFields[K]) => {
      setFields((previous) => ({ ...previous, [key]: value }));
      setChanged(true);
    },
    [],
  );

  const chooseFolder = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.cockpit.spaceMigrationChooseFolder({});
      if (result.ok) {
        setParentDir(result.value.parentDir);
        setChanged(true);
      } else if (result.error.kind !== 'cancelled') setError(result.error.message);
    } finally {
      setBusy(false);
    }
  }, []);

  const makePlan = useCallback(async () => {
    setBusy(true);
    try {
      await requestPlan(migrationFormOf(fields));
    } finally {
      setBusy(false);
    }
  }, [fields, requestPlan]);

  const run = useCallback(async () => {
    // Main runs only the values it kept for the plan; the token names that plan.
    const token = plan?.token ?? null;
    if (token === null || changed || runStarted.current) return;
    runStarted.current = true;
    setStage('running');
    setProgress({});
    setIssueProgress({});
    setRunError(null);
    setStopping(false);
    setError(null);
    const result = await window.cockpit.spaceMigrationRun({ token }).finally(() => {
      runStarted.current = false;
    });
    setStopping(false);
    if (result.ok) {
      setReport(result.value);
      setInterrupted(null);
      setStage('finished');
      return;
    }
    if (result.error.kind === 'not-planned' || result.error.kind === 'already-running') {
      setError(result.error.message);
      setStage('plan');
      return;
    }
    setRunError(result.error);
    setStage(result.error.kind === MIGRATION_STOPPED_KIND ? 'stopped' : 'failed');
  }, [plan, changed]);

  const stop = useCallback(async () => {
    const result = await window.cockpit.spaceMigrationStop({});
    if (!result.ok) setError(result.error.message);
    else setStopping(result.value.stopping);
  }, []);

  const openSpace = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.cockpit.spaceMigrationOpenSpace({});
      if (!result.ok) setError(result.error.message);
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    stage,
    fields,
    setField,
    parentDir,
    chooseFolder,
    changed,
    interrupted,
    runningElsewhere,
    makePlan,
    plan,
    planError,
    confirm: run,
    stop,
    stopping,
    runAgain: run,
    progress,
    issueProgress,
    runError,
    report,
    openSpace,
    error,
    busy,
  };
}
