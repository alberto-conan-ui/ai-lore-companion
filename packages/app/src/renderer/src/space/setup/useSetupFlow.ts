import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  SETUP_STOPPED_KIND,
  type SetupFlow,
  type SetupInputProblem,
  type SetupReport,
  type SetupStart,
  type SpaceSetupFailure,
  type SpaceSetupForm,
  type SpaceSetupInterrupted,
  type SpaceSetupPlanValue,
  type StepProgress,
} from '../../../../shared/ipc.js';

/**
 * Where the create-a-Space screens are.
 * `form`: the form is filled in. `planning`: main makes the dry run.
 * `plan`: the plan, or why there is none, waits for confirmation.
 * `running`: the steps run. `stopped`: the run was stopped before a step.
 * `failed`: a step failed. `finished`: the run reached its end.
 */
export type SetupStage =
  | 'loading'
  | 'form'
  | 'planning'
  | 'plan'
  | 'running'
  | 'stopped'
  | 'failed'
  | 'finished';

/** The fields of the three forms. Each flow sends the ones its form has. */
export type SetupFields = {
  name: string;
  description: string;
  owner: string;
  private: boolean;
  /** Create: the repositories to include, by address, each with an optional name. */
  repositories: { address: string; name: string }[];
  /** Adopt: the repository on GitHub, as `owner/name`; empty for the one of the origin. */
  github: string;
  /** Adopt: the repository's name in the Space; empty for the name part of `github`. */
  repositoryName: string;
  /** Open: the address of the Space repository. */
  address: string;
  /** Open: the name of the Space's folder; empty for the repository's name. */
  folderName: string;
};

const EMPTY_FIELDS: SetupFields = {
  name: '',
  description: '',
  owner: '',
  private: true,
  repositories: [],
  github: '',
  repositoryName: '',
  address: '',
  folderName: '',
};

/** How long the form waits after a change before main validates it, in milliseconds. */
export const SETUP_VALIDATE_DELAY_MS = 150;

/** The flow a setup window serves. Mirrors `flowOfStart` of `main/space/ipc/setup.ts`. */
export function flowOfStart(start: SetupStart): SetupFlow {
  if (start.kind === 'new') return 'create';
  return start.kind === 'from-address' ? 'open' : 'adopt';
}

/** The element id of a form's field, from core's field name: `repositories[0].github` is `setup-field-repositories-0-github`. */
export function fieldId(field: string): string {
  return `setup-field-${field.replace(/[[\].]+/g, '-').replace(/-$/, '')}`;
}

const blankToUndefined = (value: string): string | undefined =>
  value.trim() === '' ? undefined : value;

/** The form main receives. It carries no folder: main holds the folders it chose. */
export function formOf(flow: SetupFlow, fields: SetupFields, confirmed: string[]): SpaceSetupForm {
  if (flow === 'open') {
    const folderName = blankToUndefined(fields.folderName);
    return {
      flow,
      address: fields.address,
      ...(folderName === undefined ? {} : { folderName }),
      repositories: confirmed,
    };
  }
  const shared = {
    name: fields.name,
    description: fields.description,
    owner: fields.owner,
    private: fields.private,
  };
  if (flow === 'adopt') {
    const github = blankToUndefined(fields.github);
    const repositoryName = blankToUndefined(fields.repositoryName);
    return {
      flow,
      ...shared,
      ...(github === undefined ? {} : { github }),
      ...(repositoryName === undefined ? {} : { repositoryName }),
    };
  }
  return {
    flow,
    ...shared,
    repositories: fields.repositories.map((entry) => {
      const name = blankToUndefined(entry.name);
      return { address: entry.address, ...(name === undefined ? {} : { name }) };
    }),
  };
}

/** The field a problem belongs to, as the form knows it: the top of `repositories[0].github` is `repositories`. */
function topField(field: string): string {
  return field.replace(/\[.*$/, '');
}

export type SetupFlowView = {
  flow: SetupFlow;
  stage: SetupStage;
  fields: SetupFields;
  setField: <K extends keyof SetupFields>(key: K, value: SetupFields[K]) => void;
  parentDir: string | null;
  sourceDir: string | null;
  originUrl: string | null;
  interrupted: SpaceSetupInterrupted | null;
  chooseFolder: () => Promise<void>;
  /** The problems to show: those of fields that were changed, and all once the plan was asked. */
  problems: SetupInputProblem[];
  showPlan: () => Promise<void>;
  plan: SpaceSetupPlanValue | null;
  /** Why the plan could not be made. No run is offered. */
  planError: SpaceSetupFailure | null;
  backToForm: () => void;
  confirm: () => Promise<void>;
  stop: () => Promise<void>;
  stopping: boolean;
  runAgain: () => Promise<void>;
  /** The last progress of each step of the current run, by step id. */
  progress: Record<string, StepProgress>;
  runError: SpaceSetupFailure | null;
  report: SetupReport | null;
  /** Open by address: the names ticked for cloning. */
  confirmed: string[];
  toggleConfirmed: (name: string) => void;
  cloneConfirmed: () => Promise<void>;
  openSpace: () => Promise<void>;
  /** The message of the last request main refused, for the screen's error area. */
  error: string | null;
  busy: boolean;
};

/** The state and actions of the create-a-Space screens. Every folder and every run is main's. */
export function useSetupFlow(start: SetupStart): SetupFlowView {
  const flow = flowOfStart(start);
  const [stage, setStage] = useState<SetupStage>('loading');
  const [fields, setFields] = useState<SetupFields>(EMPTY_FIELDS);
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [allProblems, setAllProblems] = useState<SetupInputProblem[]>([]);
  const [parentDir, setParentDir] = useState<string | null>(null);
  const [sourceDir, setSourceDir] = useState<string | null>(
    start.kind === 'about-repository' ? start.folder : null,
  );
  const [originUrl, setOriginUrl] = useState<string | null>(null);
  const [interrupted, setInterrupted] = useState<SpaceSetupInterrupted | null>(null);
  const [plan, setPlan] = useState<SpaceSetupPlanValue | null>(null);
  const [planError, setPlanError] = useState<SpaceSetupFailure | null>(null);
  const [progress, setProgress] = useState<Record<string, StepProgress>>({});
  const [runError, setRunError] = useState<SpaceSetupFailure | null>(null);
  const [report, setReport] = useState<SetupReport | null>(null);
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [focusToken, setFocusToken] = useState(0);
  const validation = useRef(0);
  /** The confirmed names the last run was given, so that "run again" repeats that run. */
  const lastRunNames = useRef<string[]>([]);
  /** True from a click on confirm until main answers, so that a double click starts one run. */
  const runStarted = useRef(false);

  const form = useMemo(() => formOf(flow, fields, []), [flow, fields]);

  useEffect(() => {
    let live = true;
    void window.cockpit.spaceSetupState({}).then((result) => {
      if (!live) return;
      if (!result.ok) {
        setError(result.error.message);
        setStage('form');
        return;
      }
      setParentDir(result.value.parentDir);
      setSourceDir(result.value.sourceDir);
      setOriginUrl(result.value.originUrl);
      setInterrupted(result.value.interrupted);
      setStage(result.value.running ? 'running' : 'form');
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(
    () =>
      window.cockpit.onSpaceSetupProgress((event) => {
        setProgress((previous) => ({ ...previous, [event.stepId]: event }));
      }),
    [],
  );

  const validate = useCallback(
    async (candidate: SpaceSetupForm): Promise<SetupInputProblem[] | null> => {
      validation.current += 1;
      const mine = validation.current;
      const result = await window.cockpit.spaceSetupValidate(candidate);
      if (mine !== validation.current) return null;
      if (!result.ok) {
        setError(result.error.message);
        return null;
      }
      setAllProblems(result.value.problems);
      return result.value.problems;
    },
    [],
  );

  // Live validation: main validates the form a moment after each change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `parentDir` changes what main validates.
  useEffect(() => {
    if (stage !== 'form' || (touched.size === 0 && !submitted)) return;
    const timer = setTimeout(() => void validate(form), SETUP_VALIDATE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [form, parentDir, stage, touched, submitted, validate]);

  const problems = useMemo(
    () =>
      submitted
        ? allProblems
        : allProblems.filter((problem) => touched.has(topField(problem.field))),
    [allProblems, submitted, touched],
  );

  // Focus moves to the field of the first problem after a refused request for the plan.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the token is what asks for the move.
  useEffect(() => {
    if (focusToken === 0) return;
    const [first] = allProblems;
    if (first === undefined) return;
    const element =
      document.getElementById(fieldId(first.field)) ??
      document.getElementById(fieldId(topField(first.field))) ??
      document.getElementById('setup-problems');
    element?.focus();
  }, [focusToken]);

  const setField = useCallback(<K extends keyof SetupFields>(key: K, value: SetupFields[K]) => {
    setFields((previous) => ({ ...previous, [key]: value }));
    setTouched((previous) => new Set(previous).add(key));
  }, []);

  const chooseFolder = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.cockpit.spaceSetupChooseFolder({});
      if (result.ok) {
        setParentDir(result.value.parentDir);
        setTouched((previous) => new Set(previous).add('parentDir'));
      } else if (result.error.kind !== 'cancelled') setError(result.error.message);
    } finally {
      setBusy(false);
    }
  }, []);

  const showPlan = useCallback(async () => {
    setSubmitted(true);
    setError(null);
    setBusy(true);
    try {
      const found = await validate(form);
      if (found === null) return;
      if (found.length > 0) {
        setFocusToken((token) => token + 1);
        return;
      }
      setStage('planning');
      const result = await window.cockpit.spaceSetupPlan(form);
      if (!result.ok && result.error.kind === 'invalid-input') {
        setAllProblems(result.error.problems);
        setStage('form');
        setFocusToken((token) => token + 1);
        return;
      }
      setPlan(result.ok ? result.value : null);
      setPlanError(result.ok ? null : result.error);
      setStage('plan');
    } finally {
      setBusy(false);
    }
  }, [form, validate]);

  const backToForm = useCallback(() => {
    setPlan(null);
    setPlanError(null);
    setRunError(null);
    setStage('form');
  }, []);

  const run = useCallback(
    async (names: string[]) => {
      // Main runs only the plan it made and kept; the token names that plan.
      if (plan === null || runStarted.current) return;
      runStarted.current = true;
      lastRunNames.current = names;
      setStage('running');
      setProgress({});
      setRunError(null);
      setStopping(false);
      setError(null);
      const result = await window.cockpit
        .spaceSetupRun({
          token: plan.token,
          ...(flow === 'open' ? { repositories: names } : {}),
        })
        .finally(() => {
          runStarted.current = false;
        });
      setStopping(false);
      if (result.ok) {
        setReport(result.value);
        setInterrupted(null);
        setConfirmed(
          result.value.repositories
            .filter((repository) => !repository.cloned)
            .map((repository) => repository.name),
        );
        setStage('finished');
        return;
      }
      setRunError(result.error);
      setStage(result.error.kind === SETUP_STOPPED_KIND ? 'stopped' : 'failed');
    },
    [flow, plan],
  );

  const confirm = useCallback(() => run([]), [run]);
  const runAgain = useCallback(() => run(lastRunNames.current), [run]);

  const stop = useCallback(async () => {
    const result = await window.cockpit.spaceSetupStop({});
    if (!result.ok) setError(result.error.message);
    else setStopping(result.value.stopping);
  }, []);

  const toggleConfirmed = useCallback((name: string) => {
    setConfirmed((previous) =>
      previous.includes(name) ? previous.filter((item) => item !== name) : [...previous, name],
    );
  }, []);

  const cloneConfirmed = useCallback(() => run(confirmed), [run, confirmed]);

  const openSpace = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.cockpit.spaceSetupOpenSpace({});
      if (!result.ok) setError(result.error.message);
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    flow,
    stage,
    fields,
    setField,
    parentDir,
    sourceDir,
    originUrl,
    interrupted,
    chooseFolder,
    problems,
    showPlan,
    plan,
    planError,
    backToForm,
    confirm,
    stop,
    stopping,
    runAgain,
    progress,
    runError,
    report,
    confirmed,
    toggleConfirmed,
    cloneConfirmed,
    openSpace,
    error,
    busy,
  };
}
