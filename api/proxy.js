import { handleProxy } from './_core.mjs';

export default async function handler(req, res) {
  return handleProxy(req, res);
}
