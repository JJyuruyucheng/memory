import project from '../../deploy/cloudflare.public.json' with { type: 'json' };
import { createAssistantHandler, createSupabaseAssistantAuthorization } from '../../server/assistant.mjs';

const handleAssistant = createAssistantHandler({ authorize: createSupabaseAssistantAuthorization(project) });

export function onRequest({ request, env }) {
  return handleAssistant(request, env);
}
