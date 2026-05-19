import Knowledge from '../models/Knowledge';
import Student from '../models/Students';
import User from '../models/User';
import Fee from '../models/Fee';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface OpenRouterResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

export const OPENROUTER_MODELS = {
  best: 'anthropic/claude-sonnet-4.5',
  fast: 'anthropic/claude-haiku-4.5',
  cheap: 'qwen/qwen3-235b-a22b',
  gpt: 'openai/gpt-4o',
  flash: 'google/gemini-2.5-flash-lite',
  free: 'meta-llama/llama-3.3-70b-instruct'
} as const;

export type OpenRouterModelKey = keyof typeof OPENROUTER_MODELS;

export const resolveOpenRouterModel = (modelKey?: string): string => {
  if (!modelKey) {
    return process.env.OPENROUTER_MODEL || OPENROUTER_MODELS.best;
  }

  if (modelKey in OPENROUTER_MODELS) {
    return OPENROUTER_MODELS[modelKey as OpenRouterModelKey];
  }

  const allowedModel = Object.values(OPENROUTER_MODELS).find(model => model === modelKey);
  return allowedModel || process.env.OPENROUTER_MODEL || OPENROUTER_MODELS.best;
};

const getSchoolKnowledge = async (): Promise<string> => {
  const docs = await Knowledge.find({ isActive: true });
  
  if (docs.length === 0) {
    return 'No school documents have been uploaded yet. Please upload school documents from the Knowledge Base page.';
  }

  let knowledge = `SCHOOL KNOWLEDGE BASE (${docs.length} documents):\n\n`;
  
  docs.forEach(doc => {
    knowledge += `--- ${doc.category.toUpperCase().replace(/_/g, ' ')} ---\n`;
    knowledge += `File: ${doc.fileName}\n`;
    knowledge += `${doc.content}\n\n`;
  });

  return knowledge;
};

const getStudentInfo = async (parentPhone: string): Promise<string> => {
  const parent = await User.findOne({ phone: parentPhone, role: 'parent' });
  if (!parent || !parent.studentId) return '';

  const student = await Student.findById(parent.studentId);
  if (!student) return '';

  const fee = await Fee.findOne({ studentId: student._id });

  return `
PARENT'S CHILD:
Name: ${student.name}
Class: ${student.class}
Admission Number: ${student.admissionNumber}
Fee Status: ${fee ? fee.status : 'No fee record'}
Amount Paid: GHS ${fee ? fee.amountPaid : 0}
Outstanding: GHS ${fee ? fee.outstanding : 0}
  `;
};

export const getSystemPrompt = async (
  userRole: string,
  userPhone: string,
  userName: string
): Promise<string> => {

  const schoolKnowledge = await getSchoolKnowledge();
  const studentInfo = userRole === 'parent' 
    ? await getStudentInfo(userPhone) 
    : '';

  return `You are SchoolBridge, the official AI assistant 
for ${process.env.SCHOOL_NAME}. You are intelligent, 
professional, warm and helpful.

CURRENT USER:
Name: ${userName}
Role: ${userRole}
Phone: ${userPhone}

${studentInfo ? `CHILD INFORMATION:\n${studentInfo}` : ''}

SCHOOL KNOWLEDGE BASE:
${schoolKnowledge}

YOUR RULES:
- Answer ONLY from the school knowledge base above
- For parents: give personalized info about THEIR child only
- For teachers: help them communicate with parents
- For admins: help with school management tasks
- If you don't know something: say 
  "I don't have that information yet. 
  Please contact the school office directly."
- Be warm, professional and concise
- Use Ghana Cedis (GHS) for all money
- Always address users by their name
- Never share one student's info with 
  another parent

${userRole === 'parent' ? `
PARENT GUIDELINES:
- Only answer questions about their own child
- Be empathetic and supportive
- Encourage fee payments politely
- Direct complex issues to school office
` : ''}

${userRole === 'teacher' ? `
TEACHER GUIDELINES:
- Help teachers draft messages to parents
- Keep messages professional and constructive
- Always mention the student's name
- Be solution focused not just problem focused
` : ''}

${userRole === 'admin' ? `
ADMIN GUIDELINES:
- Help with school management tasks
- Generate reports when asked
- Send announcements when instructed
- Provide school statistics and insights
` : ''}`;
};

export const chatWithSchoolAgent = async (
  messages: Message[],
  userRole: string,
  userPhone: string,
  userName: string,
  modelKey?: string
): Promise<string> => {

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured.');
  }

  const systemPrompt = await getSystemPrompt(
    userRole, 
    userPhone, 
    userName
  );
  const model = resolveOpenRouterModel(modelKey);

  const response = await fetch(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://schoolbridge-backend.onrender.com',
        'X-Title': 'SchoolBridge'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages
        ],
        max_tokens: 1000,
      }),
    }
  );

  const data = await response.json() as OpenRouterResponse;

  if (!response.ok) {
    throw new Error(data.error?.message || `OpenRouter request failed with status ${response.status}`);
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenRouter returned an empty response.');
  }

  return content;
};
