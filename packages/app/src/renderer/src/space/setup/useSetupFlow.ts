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
  type SpaceSetupOwners,
  type SpaceSetupPlanProgress,
  type SpaceSetupPlanValue,
  type SpaceSetupSource,
  type SpaceSetupTargetPreview,
  type StepProgress,
} from '../../../../shared/ipc.js';

/**
 * Where the create-a-Space screens are.
 * `form`: the form is filled in. `checking`: main makes the dry run and
 * reports each of its own checks as it runs. `plan`: the confirmation waits.
 * `complete`: the plan found the Space already complete; only opening it is
 * offered. `running`: the steps run. `stopped`: the run was stopped before a
 * step. `failed`: a step failed. `finished`: the run reached its end.
 */
export type SetupStage =
  | 'loading'
  | 'form'
  | 'checking'
  | 'plan'
  | 'complete'
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

const EMPTY_OWNERS: SpaceSetupOwners = { account: null, organisations: [], defaultOwner: null };

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
export function topField(field: string): string {
  return field.replace(/\[.*$/, '');
}

/**
 * A small, display-only reading of a GitHub address, so the form can preview
 * an owner/name pair before main's own validation answers. Main's
 * `parseGitHubAddress` (core) remains the one that decides what is valid; this
 * is only ever used for a live line of text.
 */
export function previewAddressName(text: string): string | null {
  let rest = text.trim();
  if (rest === '') return null;
  const https = /^https?:\/\/(?:www\.)?github\.com\//i.exec(rest);
  const ssh = /^(?:ssh:\/\/)?git@github\.com[:/]/i.exec(rest);
  if (https !== null) rest = rest.slice(https[0].length);
  else if (ssh !== null) rest = rest.slice(ssh[0].length);
  rest = rest.replace(/\/+$/, '').replace(/\.git$/i, '');
  const parts = rest.split('/');
  const [owner, name] = parts;
  if (parts.length !== 2 || !owner || !name) return null;
  return name;
}

/** The folder name a path ends with. */
export function basenameOf(path: string): string {
  const parts = path.split(/[/\\]/).filter((part) => part !== '');
  return parts[parts.length - 1] ?? path;
}

/** `m:ss`, for the time elapsed on the checking screen. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** A command run from the result screen to fix a failure, then continue. */
export type ActiveFixCommand = { commandId: string; commandLine: string };

export type SetupFlowView = {
  flow: SetupFlow;
  start: SetupStart;
  stage: SetupStage;
  fields: SetupFields;
  setField: <K extends keyof SetupFields>(key: K, value: SetupFields[K]) => void;
  parentDir: string | null;
  sourceDir: string | null;
  originUrl: string | null;
  /** For `from-repository`: the repository chosen on the form with `chooseSource`. */
  source: SpaceSetupSource | null;
  owners: SpaceSetupOwners;
  /** For "Space from GitHub": the Spaces already on GitHub for `fields.owner`. */
  spaceList: { fullName: string; url: string; private: boolean }[] | null;
  /** The local, GitHub-free look at the target folder, from the last validation. */
  target: SpaceSetupTargetPreview | null;
  interrupted: SpaceSetupInterrupted | null;
  chooseFolder: () => Promise<void>;
  chooseSource: () => Promise<void>;
  listSpaces: (owner: string) => Promise<void>;
  openExisting: () => Promise<void>;
  /** The problems to show: those of fields that were changed, and all once the plan was asked. */
  problems: SetupInputProblem[];
  showPlan: () => Promise<void>;
  /** Returns to the form and ignores the pending answer of the plan being checked. */
  cancelCheck: () => void;
  /** The latest event of each of the plan's own checks, in first-seen order. */
  checks: SpaceSetupPlanProgress[];
  checkStartedAt: number | null;
  /** When each check was first seen running, by check id. */
  checkStarts: Record<string, number>;
  plan: SpaceSetupPlanValue | null;
  /** Why the plan could not be made. No run is offered. */
  planError: SpaceSetupFailure | null;
  backToForm: () => void;
  /** Back to the form, with the Name field focused (a name or a Project already taken). */
  focusNameAndBackToForm: () => void;
  confirm: () => Promise<void>;
  stop: () => Promise<void>;
  stopping: boolean;
  runAgain: () => Promise<void>;
  /** The last progress of each step of the current run, by step id. */
  progress: Record<string, StepProgress>;
  /** When each step was first seen running, by step id, for the current step's own elapsed time. */
  stepStarts: Record<string, number>;
  runError: SpaceSetupFailure | null;
  report: SetupReport | null;
  /** Open by address: the names ticked for cloning. */
  confirmed: string[];
  toggleConfirmed: (name: string) => void;
  cloneConfirmed: () => Promise<void>;
  openSpace: () => Promise<void>;
  /** Every command line the screens may run, by id (from the machine check). */
  commandLines: Record<string, string>;
  /** The command a failure's fix runs, or `null`. */
  activeCommand: ActiveFixCommand | null;
  /** Run a fix command of `commandLines`; its exit asks for the plan again. */
  fixAndRetry: (commandId: string) => void;
  /** Called once when the fix command's exit is pushed. */
  onFixExit: (exitCode: number) => void;
  closeFixCommand: () => void;
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
  const [source, setSource] = useState<SpaceSetupSource | null>(null);
  const [owners, setOwners] = useState<SpaceSetupOwners>(EMPTY_OWNERS);
  const [spaceList, setSpaceList] = useState<
    { fullName: string; url: string; private: boolean }[] | null
  >(null);
  const [target, setTarget] = useState<SpaceSetupTargetPreview | null>(null);
  const [interrupted, setInterrupted] = useState<SpaceSetupInterrupted | null>(null);
  const [checks, setChecks] = useState<SpaceSetupPlanProgress[]>([]);
  const [checkStartedAt, setCheckStartedAt] = useState<number | null>(null);
  const [checkStarts, setCheckStarts] = useState<Record<string, number>>({});
  const [plan, setPlan] = useState<SpaceSetupPlanValue | null>(null);
  const [planError, setPlanError] = useState<SpaceSetupFailure | null>(null);
  const [progress, setProgress] = useState<Record<string, StepProgress>>({});
  const [stepStarts, setStepStarts] = useState<Record<string, number>>({});
  const [runError, setRunError] = useState<SpaceSetupFailure | null>(null);
  const [report, setReport] = useState<SetupReport | null>(null);
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [focusToken, setFocusToken] = useState(0);
  const [focusNameToken, setFocusNameToken] = useState(0);
  const [commandLines, setCommandLines] = useState<Record<string, string>>({});
  const [activeCommand, setActiveCommand] = useState<ActiveFixCommand | null>(null);
  const validation = useRef(0);
  const planRequest = useRef(0);
  const listRequest = useRef(0);
  const highestPlanId = useRef(-1);
  const ownerDefaulted = useRef(false);
  const sourceNamed = useRef(false);
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
      setSource(result.value.source);
      setOwners(result.value.owners);
      setInterrupted(result.value.interrupted);
      const { interrupted: interruptedRun } = result.value;
      if (interruptedRun !== null) {
        setFields((previous) => ({ ...previous, ...fieldsFromForm(interruptedRun.form) }));
      }
      setStage(result.value.running ? 'running' : 'form');
    });
    return () => {
      live = false;
    };
  }, []);

  // The commands a failure's fix may run: the same map Set up this computer uses.
  useEffect(() => {
    let live = true;
    void window.cockpit.spaceMachineCheck({ fresh: false }).then((result) => {
      if (live && result.ok) setCommandLines(result.value.commands);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(
    () =>
      window.cockpit.onSpaceSetupProgress((event) => {
        setProgress((previous) => ({ ...previous, [event.stepId]: event }));
        if (event.state === 'running') {
          setStepStarts((previous) =>
            event.stepId in previous ? previous : { ...previous, [event.stepId]: Date.now() },
          );
        }
      }),
    [],
  );

  useEffect(
    () =>
      window.cockpit.onSpaceSetupPlanProgress((event) => {
        if (event.planId < highestPlanId.current) return;
        highestPlanId.current = event.planId;
        setChecks((previous) => {
          const at = previous.findIndex((check) => check.checkId === event.checkId);
          if (at === -1) return [...previous, event];
          const copy = previous.slice();
          copy[at] = event;
          return copy;
        });
        if (event.state === 'running') {
          setCheckStarts((previous) =>
            event.checkId in previous ? previous : { ...previous, [event.checkId]: Date.now() },
          );
        }
      }),
    [],
  );

  // The default owner, once known, when the Human Lead has not typed one.
  const { defaultOwner } = owners;
  useEffect(() => {
    if (ownerDefaulted.current || defaultOwner === null) return;
    ownerDefaulted.current = true;
    if (fields.owner === '') setFields((previous) => ({ ...previous, owner: defaultOwner }));
  }, [defaultOwner, fields.owner]);

  // "Space about this repository" from the form: the name defaults to "<repository>-space".
  useEffect(() => {
    if (start.kind !== 'from-repository' || source === null || sourceNamed.current) return;
    sourceNamed.current = true;
    if (fields.name === '')
      setFields((previous) => ({ ...previous, name: `${source.name}-space` }));
  }, [start.kind, source, fields.name]);

  const listSpaces = useCallback(async (owner: string): Promise<void> => {
    listRequest.current += 1;
    const mine = listRequest.current;
    if (owner.trim() === '') {
      setSpaceList(null);
      return;
    }
    const result = await window.cockpit.spaceSetupListSpaces({ owner });
    if (mine !== listRequest.current) return;
    setSpaceList(result.ok ? result.value.repositories : []);
  }, []);

  // "Space from GitHub": the list follows the chosen owner.
  useEffect(() => {
    if (flow !== 'open' || fields.owner === '') return;
    void listSpaces(fields.owner);
  }, [flow, fields.owner, listSpaces]);

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
      setTarget(result.value.target);
      return result.value.problems;
    },
    [],
  );

  // Live validation: main validates the form a moment after each change, so the
  // "What will be created" block and the target's state follow the name.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `parentDir` and `source` change what main validates.
  useEffect(() => {
    if (stage !== 'form' || (touched.size === 0 && !submitted)) return;
    const timer = setTimeout(() => void validate(form), SETUP_VALIDATE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [form, parentDir, source, stage, touched, submitted, validate]);

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

  // Focus moves to Name after "Choose another name".
  useEffect(() => {
    if (focusNameToken === 0) return;
    document.getElementById(fieldId('name'))?.focus();
  }, [focusNameToken]);

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

  const chooseSource = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.cockpit.spaceSetupChooseSource({});
      if (result.ok) {
        setSource(result.value);
        setTarget(null);
        setTouched((previous) => new Set(previous).add('sourceDir'));
      } else if (result.error.kind !== 'cancelled') setError(result.error.message);
    } finally {
      setBusy(false);
    }
  }, []);

  const openExisting = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.cockpit.spaceSetupOpenExisting({});
      if (!result.ok) setError(result.error.message);
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
      setPlan(null);
      setPlanError(null);
      setChecks([]);
      setCheckStarts({});
      setCheckStartedAt(Date.now());
      setStage('checking');
      planRequest.current += 1;
      const mine = planRequest.current;
      const result = await window.cockpit.spaceSetupPlan(form);
      if (mine !== planRequest.current) return;
      if (!result.ok && result.error.kind === 'invalid-input') {
        setAllProblems(result.error.problems);
        setStage('form');
        setFocusToken((token) => token + 1);
        return;
      }
      if (!result.ok) {
        setPlanError(result.error);
        return;
      }
      setPlan(result.value);
      setStage(result.value.plan.complete ? 'complete' : 'plan');
    } finally {
      setBusy(false);
    }
  }, [form, validate]);

  const cancelCheck = useCallback(() => {
    planRequest.current += 1;
    setPlanError(null);
    setStage('form');
  }, []);

  const backToForm = useCallback(() => {
    setPlan(null);
    setPlanError(null);
    setRunError(null);
    setStage('form');
  }, []);

  const focusNameAndBackToForm = useCallback(() => {
    backToForm();
    setFocusNameToken((token) => token + 1);
  }, [backToForm]);

  const run = useCallback(
    async (names: string[]) => {
      // Main runs only the plan it made and kept; the token names that plan.
      if (plan === null || runStarted.current) return;
      runStarted.current = true;
      lastRunNames.current = names;
      setStage('running');
      setProgress({});
      setStepStarts({});
      setRunError(null);
      setStopping(false);
      setError(null);
      setActiveCommand(null);
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

  const fixAndRetry = useCallback(
    (commandId: string) => {
      setActiveCommand({ commandId, commandLine: commandLines[commandId] ?? commandId });
    },
    [commandLines],
  );

  const onFixExit = useCallback(
    (exitCode: number) => {
      if (exitCode === 0) void showPlan();
    },
    [showPlan],
  );

  const closeFixCommand = useCallback(() => setActiveCommand(null), []);

  return {
    flow,
    start,
    stage,
    fields,
    setField,
    parentDir,
    sourceDir,
    originUrl,
    source,
    owners,
    spaceList,
    target,
    interrupted,
    chooseFolder,
    chooseSource,
    listSpaces,
    openExisting,
    problems,
    showPlan,
    cancelCheck,
    checks,
    checkStartedAt,
    checkStarts,
    plan,
    planError,
    backToForm,
    focusNameAndBackToForm,
    confirm,
    stop,
    stopping,
    runAgain,
    progress,
    stepStarts,
    runError,
    report,
    confirmed,
    toggleConfirmed,
    cloneConfirmed,
    openSpace,
    commandLines,
    activeCommand,
    fixAndRetry,
    onFixExit,
    closeFixCommand,
    error,
    busy,
  };
}

/** The fields an interrupted run's form fills in again, so the form reopens as it was. */
function fieldsFromForm(form: SpaceSetupForm): Partial<SetupFields> {
  if (form.flow === 'open') {
    return { address: form.address, folderName: form.folderName ?? '' };
  }
  const shared = {
    name: form.name,
    description: form.description,
    owner: form.owner,
    private: form.private,
  };
  if (form.flow === 'adopt') {
    return { ...shared, github: form.github ?? '', repositoryName: form.repositoryName ?? '' };
  }
  return {
    ...shared,
    repositories: form.repositories.map((entry) => ({
      address: entry.address,
      name: entry.name ?? '',
    })),
  };
}
