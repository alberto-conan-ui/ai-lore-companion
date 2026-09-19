/**
 * The engine parameter model (M10.3): splitting a parameter's text into
 * arguments, the arguments of the parameters ticked by default, and the
 * migration of an older entry's `args` into one parameter.
 */

import type { EngineParam } from './engines.js';

/** The arguments of one parameter: its text split on white space, empty parts dropped. */
export function splitParamText(text: string): string[] {
  return text.split(/\s+/).filter((part) => part.length > 0);
}

/** The arguments of the parameters with `defaultOn`, in order. */
export function defaultParamArgv(params: readonly EngineParam[]): string[] {
  return params.filter((param) => param.defaultOn).flatMap((param) => splitParamText(param.text));
}

/**
 * The migration of rule 2 of 3.4: one parameter ticked by default holding
 * every argument, or `[]` for none.
 */
export function paramsFromArgs(args: readonly string[]): EngineParam[] {
  return args.length > 0 ? [{ text: args.join(' '), defaultOn: true }] : [];
}
