// angular-eslint for Angular TEMPLATES only, external (`*.html`) and inline (`template:` in a component).
// oxlint (`.oxlintrc.json`) lints all TypeScript and cannot parse Angular templates, so this config runs
// no TypeScript rules at all: `.ts` files are parsed only so the inline-template processor can extract
// their templates, which are then linted by the `*.html` block. One linter per concern, no rule runs twice.
import angular from 'angular-eslint';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
  {
    ignores: ['.angular/**', '.output/**', '.output-*/**', 'node_modules/**', 'src/core/**', 'src/api-client/**'],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    processor: angular.processInlineTemplates,
  },
  {
    files: ['src/**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {
      '@angular-eslint/template/button-has-type': 'error',
      '@angular-eslint/template/no-inline-styles': 'warn',
      '@angular-eslint/template/prefer-control-flow': 'error',
      '@angular-eslint/template/prefer-ngsrc': 'error',
      '@angular-eslint/template/prefer-self-closing-tags': 'warn',
    },
  },
]);
