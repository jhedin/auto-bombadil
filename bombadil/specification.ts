/**
 * Top-level Bombadil specification for this project.
 *
 * Bombadil loads every property and action generator exported from this
 * module. Start from the built-in defaults (no uncaught exceptions, no error
 * logs, no 4xx/5xx responses, clicks, navigation, form input, etc.) and add
 * domain-specific properties and actions alongside them.
 *
 * Run:   npm run test:ui -- http://localhost:3000
 * Docs:  https://antithesishq.github.io/bombadil/browser/3-specification-language.html
 */
export * from "@antithesishq/bombadil/browser/defaults";
