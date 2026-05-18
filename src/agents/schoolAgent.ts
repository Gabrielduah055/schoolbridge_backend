import Knowledge from '../models/Knowledge';
import Student from '../models/Students';
import User from '../models/User';
import Fee from '../models/Fee';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const getSchoolKnowledge = async (): Promise<string> => {
  const docs = await Knowledge.find({ isActive: true });
  if (docs.length === 0) return 'No school documents uploaded yet.';
  return docs.map(d => `[${d.category}]\n${d.content}`).join('\n\n');
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
  userName: string
): Promise<string> => {

  const systemPrompt = await getSystemPrompt(
    userRole, 
    userPhone, 
    userName
  );

  const response = await fetch(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4-5',
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages
        ],
        max_tokens: 1000,
      }),
    }
  );

  const data = await response.json();
  return data.choices[0].message.content;
};
