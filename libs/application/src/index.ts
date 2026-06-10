// Application layer entry — populated by capability tracks.
//
// Convention (per docs/design/30-architecture/ + docs/typescript-swarm-playbook.md):
//   - One folder per use case, e.g. src/use-cases/book-appointment/
//   - Each use case implements an inbound port from libs/domain
//   - Outbound ports are injected (interfaces from libs/domain)
//   - No framework imports here (NestJS DI is composed at apps/app)
