import project from '../../deploy/cloudflare.public.mjs';
import { createAssistantMemoryHandler } from '../../server/assistant-memory.mjs';

const handleAssistantMemory = createAssistantMemoryHandler(project);

export function onRequest({ request, env }) {
  return handleAssistantMemory(request, env);
}
