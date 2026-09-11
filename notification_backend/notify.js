const admin = require("firebase-admin");

const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

if (!raw) {
  throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_JSON secret.");
}

const serviceAccount = JSON.parse(raw);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function main() {
  const cutoff = Date.now() - 30 * 60 * 1000;

  const snapshot = await db
    .collection("vehicle_rent_requests")
    .where("status", "==", "accepted")
    .get();

  let sent = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();

    if (data.notificationSentAt) {
      continue;
    }

    const updated = data.ownerUpdatedAt?.toDate?.();

    if (!updated || updated.getTime() < cutoff) {
      continue;
    }

    const customerId = String(data.customerId || "").trim();

    if (!customerId) {
      continue;
    }

    const tokenDoc = await db
      .collection("user_notification_tokens")
      .doc(customerId)
      .get();

    if (!tokenDoc.exists) {
      continue;
    }

    const token = String(tokenDoc.data().token || "").trim();

    if (!token) {
      continue;
    }

    const vehicle = String(
      data.vehicleType || "Vehicle"
    );

    const finalPrice =
      data.finalPrice ?? data.total ?? "";

    const body = finalPrice
      ? `${vehicle} booking accepted. Final price ₹${finalPrice}.`
      : `${vehicle} booking accepted.`;

    try {
      await admin.messaging().send({
        token: token,

        notification: {
          title: "Driver On Call 🚗",
          body: body,
        },

        data: {
          type: "vehicle_rent_accepted",
          bookingId: doc.id,
          status: "accepted",
        },

        android: {
          priority: "high",
        },
      });

      await doc.ref.update({
        notificationSentAt:
          admin.firestore.FieldValue.serverTimestamp(),
      });

      sent++;

      console.log(
        `Notification sent: ${doc.id}`
      );

    } catch (error) {
      console.error(
        `FCM failed for ${doc.id}:`,
        error.message
      );
    }
  }

  console.log(`Completed. Sent: ${sent}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
