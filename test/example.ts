export enum Status {
  Running,
  Paused
}

export enum StatusString {
  Running = "RunnN",
  Paused = "PaUSd"
}

export interface Star {
  size: number | Star;
  size2?: PlanetOrStar;
  status: Status;
  statusStr?: StatusString;
  children: Star[];
}

export interface Planet {
  population: number;
  notGood?: Alias;
  test: null[];
  habitable: number | undefined;
  habitable2: undefined | Star | string;
  habitable3: (number | Star)[];
  habitable4: PlanetOrStar[];
  habitable5?: PlanetOrStar;
}

export type PlanetOrStar = Planet | Star;

export type Alias = boolean | null;

export interface SolarSystem {
  items: Planet[];
}
