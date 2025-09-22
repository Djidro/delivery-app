const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();
const fcm = admin.messaging();

// Notify nearby drivers when restaurant accepts an order
exports.notifyDriversForOrder = functions.firestore
  .document("orders/{orderId}")
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    const orderId = context.params.orderId;

    // Only trigger when status changes to "accepted"
    if (before.status === "placed" && after.status === "accepted") {
      const order = after;
      if (!order.customerLoc) return;

      // Find drivers (simple: all available drivers)
      const driversSnap = await db.collection("drivers").where("available", "==", true).get();
      const tokens = [];
      driversSnap.forEach(async (docSnap) => {
        const tokenDoc = await db.collection("driversTokens").doc(docSnap.id).get();
        if (tokenDoc.exists) tokens.push(tokenDoc.data().token);

        // Create driverRequest docs
        await db.collection("driverRequests").add({
          driverId: docSnap.id,
          orderId,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          accepted: false
        });
      });

      if (tokens.length > 0) {
        await fcm.sendMulticast({
          tokens,
          notification: {
            title: "New Delivery Request",
            body: `Order ${orderId} is available nearby.`
          },
          data: { orderId }
        });
      }
    }
  });
