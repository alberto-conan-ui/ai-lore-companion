export type NodeRef = {
  title: string;
  /** Absolute path on disk. */
  path: string;
};

export type ChainSuccess = {
  mode: string;
  focus: NodeRef | null;
  activeChild: NodeRef | null;
  root: string;
  lorePath: string;
};

export type ChainError = {
  error: string;
};

export type ChainResult = ChainSuccess | ChainError;

export function isChainError(result: ChainResult): result is ChainError {
  return 'error' in result;
}
