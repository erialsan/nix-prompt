export const PRELUDE_FILE = "<prelude>";

export const PRELUDE_SRC = String.raw`
rec {
  character = { gender, name ? null, tags ? [ ], series ? null, text ? null, ... }:
    { inherit gender name tags series text; __src = __posOf __args; };

  mkCharacter = character;

  weighted = weight: tag: { inherit tag weight; };
}
`;
