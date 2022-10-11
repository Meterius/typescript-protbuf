export enum Status {
  Running = 0,
  Paused = 1,
  Stopped = 2,
}

export interface Msg1 {
  status: Status;
  messages: Msg2[];
}

export interface Msg2 {
  message: string;
}
