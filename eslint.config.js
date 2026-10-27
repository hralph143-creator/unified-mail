import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'

export default [
  { ignores: ['node_modules/**', 'dist/**', 'dist-electron/**', 'release/**', 'coverage/**'] },
  js.configs.recommended,
  { files: ['scripts/**/*.mjs'], languageOptions: { globals: { process: 'readonly', console: 'readonly', fetch: 'readonly', WebSocket: 'readonly', setTimeout: 'readonly' } } },
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: { parser: tseslint.parser, sourceType: 'module', extraFileExtensions: ['.vue'] },
      globals: { window: 'readonly', document: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', MouseEvent: 'readonly', HTMLElement: 'readonly' }
    }
  },
  {
    files: ['**/*.{ts,vue}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'vue/multi-word-component-names': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/html-self-closing': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/multiline-html-element-content-newline': 'off',
      'vue/first-attribute-linebreak': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/no-v-html': 'off',
      'vue/html-indent': 'off'
    }
  }
]
