// The fast-glob wrapper now lives in @pipe/protocol, shared with reports'
// subscription/walk.ts. Re-exported here so existing imports
// (`from '../walk.js'`) don't need to change.
export { walkProjectFiles } from '@pipe/protocol';
