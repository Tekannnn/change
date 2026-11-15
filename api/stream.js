import { handleStream } from './_core.mjs';

export default async function handler(req, res) {
  return handleStream(req, res);
}
