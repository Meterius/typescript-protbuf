export enum Status {
  Running,
  Paused
}

export enum StatusString {
  Running = "RunnN",
  Paused = "PaUSd"
}

export interface Star {
  classification?: string;
  c__lassification3?: "Constant",
  __lassification4: "Constant",
  __lassification5: "Constant",
  size: number | Star;
  size2?: PlanetOrStar;
  status: Status;
  statusStr?: StatusString;
  children: Array<Star>;
  children2: Array<Planet>;
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
