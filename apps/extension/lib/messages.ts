/**
 * Messages between the injected inspector (content-script world) and the
 * background service worker. The inspector cannot touch the page's JS realm
 * itself, so console evaluation round-trips through the background, which
 * re-injects into the MAIN world.
 */

export const EVALUATE_MESSAGE = "inspector-lab/evaluate" as const;

export type EvaluateRequest = {
  type: typeof EVALUATE_MESSAGE;
  expression: string;
};

export type EvaluateResponse = {
  ok: boolean;
  /** Already-serialized, human-readable preview of the result or error. */
  preview: string;
};
