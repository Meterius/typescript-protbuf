export enum Status {
  Running,
  Paused
}

export enum StatusString {
  Running = "RunnN",
  Paused = "PaUSd"
}

export interface Star {
  size: number | boolean;
  status: Status;
  statusStr?: StatusString;
  child?: Star;
}

export interface Planet {
  population?: number;
  habitable: number | undefined;
  habitable2: undefined | Star | string;
  habitable3: (number | boolean)[];
  habitable4: number[] | Star[];
  habitable5: PlanetOrStar;
}

export type PlanetOrStar = Planet | Star;

export interface SolarSystem {
  items: PlanetOrStar[];
}
