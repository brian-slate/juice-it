const js = require("@eslint/js");

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        // Node.js globals
        require: "readonly",
        module: "readonly",
        exports: "readonly",
        process: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        console: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
      },
    },
    rules: {
      // Critical errors only
      "no-undef": "error",

      // Relax unused vars - allow unused in catch blocks and callbacks
      "no-unused-vars": ["warn", {
        "argsIgnorePattern": "^_",
        "varsIgnorePattern": "^_",
        "caughtErrors": "none"  // Don't warn on unused catch params
      }],

      // Off for existing codebase
      "no-console": "off",
      "prefer-const": "off",
      "semi": "off",
      "quotes": "off",
      "no-prototype-builtins": "warn",
    },
  },
  {
    ignores: [
      "node_modules/**",
      "test/test-output/**",
    ],
  },
];
