import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // Create default admin user
  const adminPassword = await bcrypt.hash('admin123', 10);
  await prisma.adminUser.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      passwordHash: adminPassword,
      role: 'ADMIN',
    },
  });

  // Create default guard user
  const guardPassword = await bcrypt.hash('guard123', 10);
  await prisma.adminUser.upsert({
    where: { username: 'guard' },
    update: {},
    create: {
      username: 'guard',
      passwordHash: guardPassword,
      role: 'GUARD',
    },
  });

  // Create default message templates
  const templates = [
    {
      key: 'parent_not_found',
      name: 'הורה לא נמצא',
      body: 'שלום, המספר שלך לא מזוהה במערכת. אנא פנה למזכירות בית הספר.',
    },
    {
      key: 'welcome',
      name: 'הודעת פתיחה',
      body: 'שלום {{parentName}}, ברוכים הבאים למערכת אישור יציאות בית הספר. אנא שלח את שם התלמיד/ה, תאריך ושעת היציאה.',
    },
    {
      key: 'student_selection',
      name: 'בחירת תלמיד',
      body: 'נמצאו מספר תלמידים:\n{{studentList}}\nאנא שלח את המספר המתאים.',
    },
    {
      key: 'datetime_request',
      name: 'בקשת תאריך ושעה',
      body: 'עבור {{studentName}}, אנא שלח את תאריך ושעת היציאה הרצויים.\nלדוגמה: "היום בשעה 12:00" או "מחר 10:30"',
    },
    {
      key: 'request_sent_to_teacher',
      name: 'בקשה נשלחה למורה',
      body: 'בקשת היציאה עבור {{studentName}} נשלחה ל{{teacherName}}. אנא המתן לאישור.',
    },
    {
      key: 'teacher_approval_request',
      name: 'בקשת אישור למורה',
      body: 'שלום {{teacherName}},\nהתקבלה בקשת יציאה:\nתלמיד/ה: {{studentName}}\nכיתה: {{className}}\nתאריך: {{exitDate}}\nשעה: {{exitTime}}\nמבקש: {{parentName}}\n\nאנא השב:\n1. אישור ✅\n2. דחייה ❌',
    },
    {
      key: 'teacher_pending',
      name: 'ממתין לתשובת מורה',
      body: 'הבקשה עבור {{studentName}} עדיין ממתינה לאישור {{teacherName}}.\n\n1. המתן\n2. הסלם למזכירות\n3. הסלם למנהל',
    },
    {
      key: 'request_approved',
      name: 'בקשה אושרה',
      body: '✅ בקשת היציאה עבור {{studentName}} אושרה על ידי {{teacherName}}.\nתאריך: {{exitDate}}\nשעה: {{exitTime}}',
    },
    {
      key: 'request_rejected',
      name: 'בקשה נדחתה',
      body: '❌ בקשת היציאה עבור {{studentName}} נדחתה על ידי {{teacherName}}.',
    },
    {
      key: 'guard_notification',
      name: 'הודעה לשומר',
      body: '🚪 יציאה מאושרת:\nתלמיד/ה: {{studentName}}\nכיתה: {{className}}\nשעה: {{exitTime}}\nאושר ע"י: {{teacherName}}',
    },
    {
      key: 'escalated',
      name: 'הסלמה',
      body: 'הבקשה עבור {{studentName}} הועברה ל{{escalatedToName}}.',
    },
  ];

  for (const template of templates) {
    await prisma.messageTemplate.upsert({
      where: { key: template.key },
      update: { name: template.name, body: template.body },
      create: template,
    });
  }

  console.log('Seed completed successfully');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
