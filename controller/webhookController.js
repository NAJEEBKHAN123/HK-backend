const Booking = require('../model/webhookModel');
const emailService = require('../utils/mailer'); // Import your email service

const sendConfirmationEmail = async (email, name) => {
  const mailOptions = {
    from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`,
    to: email,
    subject: 'Booking Confirmed',
    html: `<p>Hello ${name},<br/>Your booking has been received. We'll be in touch soon!</p>`
  };

  await emailService.sendEmail(mailOptions);
};

exports.handleWebhook = async (req, res) => {
  try {
    const { payload } = req.body;
    console.log("📦 Webhook payload:", JSON.stringify(payload, null, 2));

    const bookingData = {
      eventId: payload.event.uuid,
      eventName: payload.event.name,
      invitee: {
        name: payload.invitee.name,
        email: payload.invitee.email,
        phone: payload.invitee.text_reminder_number || null
      },
      guests: payload.invitee.guests?.map(g => ({
        name: g.name,
        email: g.email
      })) || [],
      meetingMethod: getMeetingMethod(payload.event.location),
      locationDetails: payload.event.location?.location || payload.event.location?.join_url || 'N/A',
      ...extractQuestions(payload.questions_and_answers),
      status: 'scheduled'
    };

    await Booking.create(bookingData);

    // Send confirmation to user
    await sendConfirmationEmail({
      name: payload.invitee.name,
      email: payload.invitee.email
    });

    // Send notification to admin
    await sendContactEmail({
      name: payload.invitee.name,
      email: payload.invitee.email,
      phone: payload.invitee.text_reminder_number,
      message: 'New booking appointment'
    });

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("❌ Webhook error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getBookings = async (req, res) => {
  try {
    const bookings = await Booking.find();
    res.status(200).json(bookings);
  } catch (err) {
    console.error('❌ Error fetching bookings:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

function getMeetingMethod(calendlyLocation) {
  if (!calendlyLocation) return 'other';

  const methodMap = {
    'zoom': 'zoom',
    'google_meet': 'google_meet',
    'ask_invitee': 'phone',
    'physical_location': 'in_person'
  };

  return methodMap[calendlyLocation.type] || 'other';
}

function extractQuestions(qnaArray) {
  const questions = {};

  qnaArray?.forEach(q => {
    const questionText = q.question.toLowerCase();
    const answer = q.answer?.trim();

    if (!answer) return; // Skip empty answers

    if (questionText.includes('current status')) {
      questions.currentStatus = answer.toLowerCase();
    } else if (questionText.includes('main objective')) {
      questions.mainObjective = answer;
    } else if (questionText.includes('type of business')) {
      questions.businessType = answer;
    } else if (questionText.includes('estimated') && questionText.includes('revenue')) {
      questions.estimatedRevenue = answer;
    } else if (questionText.includes('already have') && questionText.includes('company')) {
      questions.existingCompany = answer;
    } else if (questionText.includes('specific question')) {
      questions.specificQuestions = answer;
    }
  });

  // console.log('🧾 Extracted questions:', questions);
  return questions;
}