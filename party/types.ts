export type Phase = "lobby" | "countdown" | "playing" | "reveal" | "gameover";

export type RevealReason = "guessed" | "said_secret" | "timeout";

export type Player = {
  id: string;
  name: string;
  score: number;
  connected: boolean;
};

export type PublicReveal = {
  clue: string;
  reason: RevealReason;
  winnerName: string | null;
  roast: string;
};

export const DRAWING_STAMPS = [
  "mountain",
  "river",
  "cloud",
  "sun",
  "moon",
  "tree",
  "house",
  "person",
  "cat",
  "dog",
  "bird",
  "fish",
  "boat",
  "car",
  "windmill",
  "bear",
] as const;

export type DrawingStamp = (typeof DRAWING_STAMPS)[number];

export const DRAWING_STAMP_ALIASES: Record<string, DrawingStamp> = {
  animal: "bear",
  beach: "river",
  blades: "windmill",
  building: "house",
  cabin: "house",
  castle: "house",
  child: "person",
  duck: "bird",
  fan: "windmill",
  forest: "tree",
  furry: "bear",
  ghost: "person",
  guy: "person",
  human: "person",
  hut: "house",
  kid: "person",
  king: "person",
  lady: "person",
  lake: "river",
  mill: "windmill",
  ocean: "river",
  owl: "bird",
  pole: "windmill",
  queen: "person",
  sand: "river",
  sea: "river",
  shark: "fish",
  star: "sun",
  teddy: "bear",
  tent: "house",
  tower: "house",
  turbine: "windmill",
  umbrella: "tree",
  vampire: "person",
  van: "car",
  water: "river",
  wave: "river",
  waves: "river",
  whale: "fish",
  witch: "person",
  wizard: "person",
  zombie: "person",
};

export const DRAWING_COLORS = [
  "black",
  "blue",
  "brown",
  "gray",
  "green",
  "orange",
  "pink",
  "purple",
  "red",
  "white",
  "yellow",
] as const;

export type DrawingColor = (typeof DRAWING_COLORS)[number];
export type DrawingSize = "small" | "medium" | "large";

export type DrawingOp = {
  stamp: DrawingStamp;
  color: DrawingColor;
  size: DrawingSize;
  count: number;
  x: number;
  y: number;
};

export type PublicState = {
  phase: Phase;
  code: string;
  round: number;
  totalRounds: 5;
  timeLeft: number;
  players: Player[];
  yapperId: string | null;
  hostId: string | null;
  seed: number;
  prompt: string;
  paintingGeneration: number;
  paintStartedAt: number;
  drawingOps: DrawingOp[];
  reveal?: PublicReveal;
};

export type Clue = {
  id: string;
  text: string;
  banned: string[];
  pack: "easy" | "weird" | "culture";
};

export type ClientMessage =
  | { type: "join"; name: string }
  | { type: "start" }
  | { type: "utterance"; text: string }
  | { type: "guess"; text: string };

export type ServerMessage =
  | { type: "you"; id: string; isHost: boolean }
  | { type: "secret"; clue: string; banned: string[] }
  | { type: "state"; state: PublicState }
  | { type: "guess"; name: string; text: string; correct: boolean }
  | { type: "toast"; text: string };
