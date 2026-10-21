import data from "../data/cards.json";
import type { Card, Cards } from "./game";

export const catalog = data as unknown as Card[];
export const cards: Cards = Object.fromEntries(catalog.map(card => [card.id, card]));
export const characters = catalog.filter(card => card.type === "character");
export const typeLabels: Record<string, string> = {
  character: "Postava", girl: "Dievča", support: "Podpora", tame: "Tame", charge: "Charge", ability: "Schopnosť", harem: "Hárem",
};
