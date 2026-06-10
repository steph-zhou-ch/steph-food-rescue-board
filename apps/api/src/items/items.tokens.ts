// DI tokens for the items module. The ItemStore (in-memory singleton)
// and the Clock port are injected via these tokens so the production
// wiring binds real implementations and tests can bind fakes.

export const ITEM_STORE = Symbol('ITEM_STORE');
export const CLOCK = Symbol('CLOCK');
