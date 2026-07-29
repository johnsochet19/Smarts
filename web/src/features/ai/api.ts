import { api } from '@/lib/api';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export const aiApi = {
  chat: (messages: ChatMessage[], projectId: number | null) =>
    api.post<{ reply: string }>('/ai/chat', {
      messages,
      project_id: projectId ?? undefined,
      message: messages[messages.length - 1]?.content,
    }),
};

export const SUGGESTED_PROMPTS = [
  'Which projects are behind schedule?',
  'Which punch items are overdue?',
  'Where are the bottlenecks right now?',
  'Summarize the status of this project.',
  'What should the team focus on this week?',
];
