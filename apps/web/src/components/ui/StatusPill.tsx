/**
 * The pill is gone: a status is a shape and a word now. These names stay so the pages that still
 * import them keep building while they move to StatusMark.
 */
export {
  StatusMark as StatusPill,
  type StatusMarkProps as StatusPillProps,
  TaskStatusMark as TaskStatusPill,
  type TaskStatusMarkProps as TaskStatusPillProps,
} from "./StatusMark.js";
