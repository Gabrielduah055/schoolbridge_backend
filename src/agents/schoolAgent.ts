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
    code?: string | number;
    message?: string;
    metadata?: {
      provider_name?: string;
      raw?: unknown;
      [key: string]: unknown;
    };
  };
  provider?: string;
  model?: string;
}

type StudentRecord = Record<string, any>;

export const OPENROUTER_MODELS = {
  best: 'anthropic/claude-sonnet-4.5',
  fast: 'anthropic/claude-haiku-4.5',
  cheap: 'qwen/qwen3-235b-a22b',
  gpt: 'openai/gpt-4o',
  flash: 'google/gemini-2.5-flash-lite',
  free: 'meta-llama/llama-3.3-70b-instruct:free'
} as const;

export type OpenRouterModelKey = keyof typeof OPENROUTER_MODELS;

const DEFAULT_OPENROUTER_FALLBACK_MODELS = [
  'openrouter/owl-alpha',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free'
];

export const resolveOpenRouterModel = (modelKey?: string): string => {
  if (!modelKey) {
    return process.env.OPENROUTER_MODEL || OPENROUTER_MODELS.free;
  }

  if (modelKey in OPENROUTER_MODELS) {
    return OPENROUTER_MODELS[modelKey as OpenRouterModelKey];
  }

  const allowedModel = Object.values(OPENROUTER_MODELS).find(model => model === modelKey);
  return allowedModel || process.env.OPENROUTER_MODEL || OPENROUTER_MODELS.free;
};

const getOpenRouterFallbackModels = (primaryModel: string): string[] => {
  const configuredFallbacks = (process.env.OPENROUTER_FALLBACK_MODELS || '')
    .split(',')
    .map(model => model.trim())
    .filter(Boolean);

  return Array.from(new Set([
    primaryModel,
    ...configuredFallbacks,
    ...DEFAULT_OPENROUTER_FALLBACK_MODELS
  ]));
};

const stringifyForLog = (value: unknown): string => {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const buildOpenRouterError = (
  response: Response,
  data: OpenRouterResponse,
  model: string
): Error => {
  const provider = data.error?.metadata?.provider_name || data.provider || 'unknown provider';
  const rawProviderError = stringifyForLog(data.error?.metadata?.raw);
  const details = [
    `OpenRouter request failed for ${model}`,
    `status=${response.status}`,
    `code=${data.error?.code || 'unknown'}`,
    `provider=${provider}`,
    `message=${data.error?.message || 'No error message returned'}`
  ];

  if (rawProviderError) {
    details.push(`raw=${rawProviderError.slice(0, 500)}`);
  }

  return new Error(details.join(' | '));
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
Gender: ${student.gender || 'Not recorded'}
Age: ${student.age || 'Not recorded'}
Admission Status: ${student.admissionStatus || 'Not recorded'}
Parent/Guardian: ${student.parentName || 'Not recorded'}
Emergency Contact: ${student.emergencyContactName || 'Not recorded'} ${student.emergencyContactPhone || ''}
Medical Condition: ${student.medicalCondition || 'None recorded'}
Allergies: ${student.allergies || 'None recorded'}
Medication Required: ${student.medicationRequired || 'None recorded'}
Special Learning Need: ${student.specialLearningNeed || 'None recorded'}
Transport Needed: ${student.transportNeeded ? 'Yes' : 'No'}
Feeding Service: ${student.feedingService ? 'Yes' : 'No'}
Fee Status: ${fee ? fee.status : 'No fee record'}
Amount Paid: GHS ${fee ? fee.amountPaid : 0}
Outstanding: GHS ${fee ? fee.outstanding : 0}
  `;
};

const compact = (value: unknown): string => {
  if (value === undefined || value === null || value === '') return 'Not recorded';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim() || 'Not recorded';
};

const yesNo = (value: unknown): string => value ? 'Yes' : 'No';

const formatStudentRecord = (student: StudentRecord): string => {
  const docs = student.admissionDocuments || {};

  return [
    `- ${compact(student.name)} (${compact(student.admissionNumber)})`,
    `Class: ${compact(student.class)} | Gender: ${compact(student.gender)} | Age: ${compact(student.age)} | DOB: ${compact(student.dateOfBirth)}`,
    `Admission: ${compact(student.admissionType)} / ${compact(student.admissionStatus)}`,
    `Parent/Guardian: ${compact(student.parentName)} (${compact(student.relationship)}) | Phone: ${compact(student.parentPhone)} | Alt: ${compact(student.parentPhone2)} | Email: ${compact(student.parentEmail)}`,
    `Residence: ${compact(student.residentialArea)} | Emergency: ${compact(student.emergencyContactName)} ${compact(student.emergencyContactPhone)}`,
    `Health: ${compact(student.medicalCondition)} | Allergies: ${compact(student.allergies)} | Medication: ${compact(student.medicationRequired)} | Blood: ${compact(student.bloodGroup)} | Doctor/Hospital: ${compact(student.doctorHospitalContact)}`,
    `Support: ${compact(student.specialLearningNeed)} | Transport: ${yesNo(student.transportNeeded)} | Feeding: ${yesNo(student.feedingService)}`,
    `Documents: Birth Certificate=${compact(docs.birthCertificate)}, Photos=${compact(docs.passportPhotos)}, Report=${compact(docs.previousSchoolReport)}, Transfer=${compact(docs.transferLetter)}, Health=${compact(docs.healthImmunizationRecord)}, Parent ID=${compact(docs.parentGuardianId)}, Emergency Details=${compact(docs.emergencyContactDetails)}, Other=${compact(docs.otherDocuments)}`,
    `Notes: ${compact(student.notes)}`
  ].join('\n');
};

const getStudentRecordsContext = async (userRole: string): Promise<string> => {
  if (!['admin', 'teacher'].includes(userRole)) {
    return '';
  }

  const students = await Student.find({ status: 'active' })
    .sort({ class: 1, name: 1 })
    .limit(250)
    .lean();

  if (students.length === 0) {
    return 'No imported student records are available yet.';
  }

  const classCounts = students.reduce<Record<string, number>>((counts, student: StudentRecord) => {
    const className = compact(student.class);
    counts[className] = (counts[className] || 0) + 1;
    return counts;
  }, {});

  return [
    `IMPORTED STUDENT RECORDS (${students.length} active students available to ${userRole}s):`,
    `Class counts: ${Object.entries(classCounts).map(([name, count]) => `${name}: ${count}`).join(', ')}`,
    '',
    ...students.map((student) => formatStudentRecord(student))
  ].join('\n');
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
  const studentRecords = await getStudentRecordsContext(userRole);

  return `You are SchoolBridge, the official AI assistant 
for ${process.env.SCHOOL_NAME}. You are intelligent, 
professional, warm and helpful.

CURRENT USER:
Name: ${userName}
Role: ${userRole}
Phone: ${userPhone}

${studentInfo ? `CHILD INFORMATION:\n${studentInfo}` : ''}
${studentRecords ? `AUTHORIZED STUDENT RECORDS:\n${studentRecords}` : ''}

SCHOOL KNOWLEDGE BASE:
${schoolKnowledge}

YOUR RULES:
- Answer ONLY from the school knowledge base and authorized student records above
- For parents: give personalized info about THEIR child only
- For teachers: help them communicate with parents
- For admins: help with school management tasks
- Parents must never receive another student's record, medical detail, contact, or fee detail
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
- Provide school statistics and insights from imported student records when available
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
  const modelsToTry = getOpenRouterFallbackModels(model);
  let lastError: Error | null = null;

  for (const modelToTry of modelsToTry) {
    let response: Response;
    let data: OpenRouterResponse;

    try {
      response = await fetch(
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
            model: modelToTry,
            messages: [
              { role: 'system', content: systemPrompt },
              ...messages
            ],
            max_tokens: 400,
          }),
        }
      );

      data = await response.json() as OpenRouterResponse;
    } catch (error) {
      lastError = error instanceof Error
        ? error
        : new Error(`OpenRouter network request failed for ${modelToTry}.`);
      console.error(`OpenRouter network request failed for ${modelToTry}: ${lastError.message}`);
      continue;
    }

    if (!response.ok || data.error) {
      lastError = buildOpenRouterError(response, data, modelToTry);
      console.error(lastError.message);
      continue;
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      lastError = new Error(`OpenRouter returned an empty response for ${modelToTry}.`);
      console.error(lastError.message);
      continue;
    }

    if (modelToTry !== model) {
      console.log(`OpenRouter fallback succeeded with ${modelToTry}`);
    }

    return content;
  }

  throw lastError || new Error('OpenRouter request failed.');
};
