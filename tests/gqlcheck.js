const fs = require('fs');
const { buildSchema, parse, validate } = require('graphql');
const schema = buildSchema(fs.readFileSync(process.argv[3], 'utf8'), { assumeValidSDL: true, assumeValid: true });
const src = fs.readFileSync(process.argv[2], 'utf8');
const q = src.split('/* gql:start */ `')[1].split('` /* gql:end */')[0];
const errs = validate(schema, parse(q));
console.log(errs.length ? errs.map((e) => e.message).join('\n') : 'GraphQL query is valid against GitHub schema');
process.exit(errs.length ? 1 : 0);
