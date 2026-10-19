// Demo scenes for the Qwen scene-mapper build: only cat, tree, house, sun and cloud, with colors, sizes and simple relations,
// so every scene can be drawn with the scene engine. Banned words are the object nouns in the scene text (plurals are caught
// by the stem matcher). A guess is right when it names every object and every color in the scene.
import type { Clue } from "./types";

const scene = (id: string, text: string, objects: string[], colors: string[] = []): Clue => ({
  id, text, banned: objects, required: [...objects, ...colors], pack: "demo",
});

export const DEMO_SCENES: Clue[] = [
  scene("cat-house-sun", "a cat on a house under the sun", ["cat", "house", "sun"]),
  scene("tree-red-house", "a tree next to a red house", ["tree", "house"], ["red"]),
  scene("clouds-tree", "two clouds above a tree", ["cloud", "tree"]),
  scene("blue-cat-tree", "a blue cat under a tree", ["cat", "tree"], ["blue"]),
  scene("sun-cloud-top", "a sun and a cloud at the top", ["sun", "cloud"]),
  scene("yellow-house-sun", "a yellow house with the sun above it", ["house", "sun"], ["yellow"]),
  scene("three-trees", "three trees and a cat", ["tree", "cat"]),
  scene("cat-tree-left", "a cat next to a tree on the left", ["cat", "tree"]),
  scene("gray-cloud-house", "a gray cloud over a house", ["cloud", "house"], ["gray"]),
  scene("big-sun-small-cloud", "a big sun and a small cloud", ["sun", "cloud"]),
  scene("pink-tree-green-cat", "a pink tree and a green cat", ["tree", "cat"], ["pink", "green"]),
  scene("two-cats-house", "two cats on a house", ["cat", "house"]),
  scene("house-trees-sides", "a house with a tree on each side", ["house", "tree"]),
  scene("black-cat-cloud", "a black cat under a cloud", ["cat", "cloud"], ["black"]),
  scene("purple-sun-tree", "a purple sun over a tree", ["sun", "tree"], ["purple"]),
  scene("white-house-orange-cat", "a white house and an orange cat", ["house", "cat"], ["white", "orange"]),
  scene("tree-right-house-left", "a tree on the right and a house on the left", ["tree", "house"]),
  scene("small-house-big-cloud", "a small house under a big cloud", ["house", "cloud"]),
];
