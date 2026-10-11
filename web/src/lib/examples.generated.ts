// このファイルは scripts/gen-examples.ts が生成します。手で編集しないでください。
// 再生成: bun run web:examples

export type ExampleEntry = {
  /** examples/ からの相対パス（表示名） */
  name: string;
  /** UI に出す短い説明 */
  title: string;
  /** プロンプトのソース */
  source: string;
};

export const EXAMPLES: ExampleEntry[] = [
  {
    "name": "girl-and-cat.np",
    "title": "girl + animal",
    "source": "let\n  miku = character {\n    name = \"hatsune miku\";\n    gender = \"girl\";\n    series = \"vocaloid\";\n    tags = {\n      looks = [ \"twintails\" \"aqua eyes\" ];\n    };\n  };\n  cat = character {\n    gender = \"animal\";\n    species = \"cat\";\n    tags = [ \"black fur\" \"green eyes\" ];\n  };\nin\n{\n  model = \"anima\";\n  humans = 1;\n  characters = [ miku cat ];\n  quality = [ \"masterpiece\" \"best quality\" ];\n  rating = \"safe\";\n  tags = [ \"sitting on bed\" ];\n  text = [ \"the girl is petting the cat.\" ];\n}\n"
  },
  {
    "name": "solo.np",
    "title": "1人（タグ形式）",
    "source": "{\n  model = \"anima\";\n  humans = 1;\n  characters = [\n    (character {\n      name = \"hatsune miku\";\n      gender = \"girl\";\n      series = \"vocaloid\";\n      tags = {\n        looks  = [ \"twintails\" (weighted 1.5 \"aqua eyes\") ];\n        outfit = [ \"neck ribbon\" ];\n      };\n    })\n  ];\n  quality = [ \"masterpiece\" ];\n  meta = [ \"highres\" ];\n  era = [ \"year 2025\" ];\n  rating = \"sensitive\";\n  artists = [ \"wlop\" ];\n  tags = [ \"stage lights\" \"holding microphone\" ];\n  negative = [ \"extra arms\" ];\n}\n"
  },
  {
    "name": "two-people.np",
    "title": "2人（自然言語へ展開）",
    "source": "let\n  miku = character {\n    name = \"hatsune miku\";\n    gender = \"girl\";\n    series = \"vocaloid\";\n    tags = {\n      looks  = [ \"twintails\" \"aqua eyes\" ];\n      outfit = [ \"neck ribbon\" ];\n    };\n  };\n  listener = character {\n    gender = \"boy\";\n    tags = [ \"black hair\" \"glasses\" \"school uniform\" ];\n  };\nin\n{\n  model = \"anima\";\n  humans = 2;\n  characters = [ miku listener ];\n  quality = [ \"masterpiece\" \"best quality\" ];\n  rating = \"safe\";\n  artists = [ \"wlop\" ];\n  tags = [ \"classroom\" \"sunlight\" ];\n  text = [ \"the girl is singing and the boy is listening.\" ];\n}\n"
  }
];

export const ERROR_EXAMPLES: ExampleEntry[] = [
  {
    "name": "errors/count-mismatch.np",
    "title": "人数タグの不一致",
    "source": "{\n  model = \"anima\";\n  humans = 2;\n  characters = [\n    (character { gender = \"girl\"; tags = [ \"twintails\" ]; })\n    (character { gender = \"boy\"; tags = [ \"black hair\" ]; })\n  ];\n  tags = [ \"2girls\" \"classroom\" ];\n  rating = \"safe\";\n}\n"
  },
  {
    "name": "errors/duplicate-character.np",
    "title": "同一キャラクターの重複",
    "source": "{\n  model = \"anima\";\n  humans = 2;\n  characters = [\n    (character {\n      name = \"hatsune miku\";\n      gender = \"girl\";\n      series = \"vocaloid\";\n      tags = { looks = [ \"twintails\" ]; };\n    })\n    (character {\n      name = \"hatsune miku\";\n      gender = \"girl\";\n      series = \"vocaloid\";\n      tags = { looks = [ \"twintails\" ]; outfit = [ \"school uniform\" ]; };\n    })\n  ];\n  rating = \"safe\";\n}\n"
  },
  {
    "name": "errors/multiple-series.np",
    "title": "複数作品の混在",
    "source": "{\n  model = \"anima\";\n  humans = 2;\n  characters = [\n    (character { name = \"hatsune miku\"; gender = \"girl\"; series = \"vocaloid\"; tags = [ \"twintails\" ]; })\n    (character { name = \"naruto\"; gender = \"boy\"; series = \"naruto\"; tags = [ \"blonde hair\" ]; })\n  ];\n  rating = \"safe\";\n}\n"
  },
  {
    "name": "errors/too-many.np",
    "title": "人数オーバー",
    "source": "{\n  model = \"anima\";\n  humans = 2;\n  characters = [\n    (character { gender = \"girl\"; tags = [ \"twintails\" ]; })\n    (character { gender = \"boy\"; tags = [ \"black hair\" ]; })\n    (character { gender = \"girl\"; tags = [ \"long hair\" ]; })\n  ];\n  rating = \"safe\";\n}\n"
  },
  {
    "name": "errors/underscore.np",
    "title": "アンダースコア（Anima）",
    "source": "{\n  model = \"anima\";\n  humans = 1;\n  characters = [\n    (character { gender = \"girl\"; tags = [ \"long_hair\" \"looking_at_viewer\" ]; })\n  ];\n  rating = \"safe\";\n}\n"
  }
];
