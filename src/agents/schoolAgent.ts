import Knowledge from '../models/Knowledge';
import Student from '../models/Students';
import Fee from '../models/Fee';
import { getPhoneLookupCandidates } from '../utils/phone';
import logger from '../utils/logger';

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
  const phoneCandidates = getPhoneLookupCandidates(parentPhone);

  // Source of truth: Students collection only.
  // We no longer query User.studentId here — that path was removed in Phase 1
  // because it could associate a student with a parent via a stale User record
  // that no longer matched the Students collection.
  const students = await Student.find({
    status: 'active',
    $or: [
      { parentPhone:  { $in: phoneCandidates } },
      { parentPhone2: { $in: phoneCandidates } }
    ]
  }).sort({ class: 1, name: 1 });

  if (students.length === 0) return '';

  const feeRecords = await Fee.find({
    studentId: { $in: students.map(s => s._id) }
  });
  const feeByStudentId = new Map(
    feeRecords.map(fee => [fee.studentId.toString(), fee])
  );

  return students.map((student, index) => {
    const fee = feeByStudentId.get(student._id.toString());

    return `
PARENT'S CHILD${students.length > 1 ? ` ${index + 1}` : ''}:
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
  }).join('\n');
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
  
  // Only fetch student info for parents with real phone numbers
  // telegram_ prefix means we need to look up via TelegramIdentity
  let studentInfo = '';

  // TelegramSession always stores the real phone — no telegram_ prefix workaround needed
  if (userRole === 'parent' && userPhone) {
    studentInfo = await getStudentInfo(userPhone);
  }

  const studentRecords = await getStudentRecordsContext(userRole);

  return `You are SchoolBridge, the official AI assistant for ${process.env.SCHOOL_NAME}.
You are intelligent, professional, warm and helpful.

CURRENT USER:
Name: ${userName}
Role: ${userRole}

${studentInfo ? `CHILD INFORMATION (ONLY share this with the authenticated parent above):
${studentInfo}` : ''}
${studentRecords ? `AUTHORIZED STUDENT RECORDS:
${studentRecords}` : ''}

SCHOOL KNOWLEDGE BASE:
${schoolKnowledge}

CORE RULES (NEVER break these):
- Answer ONLY from the school knowledge base and authorized data above
- NEVER reveal individual student records, fee details, phone numbers, or medical
  information to any user whose role is NOT 'parent' or 'admin' or 'teacher'
- Parents ONLY receive information about THEIR OWN children listed under CHILD INFORMATION
- NEVER cross-share one parent's child info with another parent
- If asked about a student not in your CHILD INFORMATION section, refuse politely
- If you don't know something, say: "I don't have that information. Please contact
  the school office directly."
- Be warm, professional, and concise
- Use Ghana Cedis (GHS) for all money
- Always address users by their name

${userRole === 'parent' ? `
PARENT GUIDELINES:
- You have access ONLY to your own child's information listed above
- Answer questions about your child's fees, class, schedule, and welfare
- If asked about another student by name, say you can only help with their own child
- Encourage fee payments politely if outstanding balance > 0
- Direct complex or sensitive issues to the school office

PARENT-TO-TEACHER INTENT RULE (highest priority for parents):
If the parent wants to send a message, inform, notify, or pass a message TO their child's teacher,
respond ONLY with this JSON and nothing else:
{"intent":"message_teacher","message":"<extracted standalone message to forward to the teacher>"}

Examples that trigger this:
- "Please tell my son's teacher he was sick"
- "Inform the teacher Ama won't be in school tomorrow"
- "Can you pass a message to Kofi's teacher?"
- "Tell the teacher he had a doctor's appointment"
- "My child was absent because of a family emergency"

The extracted "message" must be a complete, standalone sentence suitable to forward directly to the teacher.
Do NOT include meta-instructions like "please tell" or "pass this to the teacher" in the extracted message.
If the parent is asking about fees, records, schedule, or general school info — respond normally.
` : ''}


${userRole === 'unregistered' ? `
VISITOR GUIDELINES:
- This user's phone number is NOT registered as a parent/guardian in our system
- You have NO access to any individual student records, fee information, or personal data
- Do NOT share any student names, class lists, fee amounts, or guardian contacts
- You CAN answer general questions: school calendar, policies, admission process,
  contact details, general fee structures (not individual fees)
- Encourage the visitor to contact the school office to register their guardian details
- If asked about a specific student, politely decline and direct them to the office
` : ''}

${userRole === 'teacher' ? `
TEACHER GUIDELINES:
- Help teachers draft messages to parents professionally
- Keep messages constructive and solution-focused
- Always mention the student's name in communications
` : ''}

${userRole === 'admin' ? `
ADMIN GUIDELINES:
- Help with school management tasks
- Generate reports and statistics from student records when asked
- Provide school insights and summaries
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
      logger.error({ model: modelToTry, err: lastError }, 'OpenRouter network request failed');
      continue;
    }

    if (!response.ok || data.error) {
      lastError = buildOpenRouterError(response, data, modelToTry);
      logger.error({ model: modelToTry, err: lastError }, 'OpenRouter API error');
      continue;
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      lastError = new Error(`OpenRouter returned an empty response for ${modelToTry}.`);
      logger.error({ model: modelToTry, err: lastError }, 'OpenRouter empty response');
      continue;
    }

    if (modelToTry !== model) {
      logger.info({ fallbackModel: modelToTry }, 'OpenRouter fallback succeeded');    }

    return content;
  }

  throw lastError || new Error('OpenRouter request failed.');
};
