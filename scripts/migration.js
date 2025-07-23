// deleteAllOrders.js

const mongoose = require('mongoose');
const Order = require('../model/Order'); // Adjust path if needed

// ✅ Use your actual Atlas DB URI
const MONGO_URI = 'mongodb+srv://najeebkhan:najeebkhan12@user-management-cluster.zkw9a.mongodb.net/CareerSociete?retryWrites=true&w=majority&appName=user-management-cluster';

const deleteOrders = async () => {
  try {
    await mongoose.connect(MONGO_URI);

    const result = await Order.deleteMany({});
    console.log(`✅ Deleted ${result.deletedCount} orders`);

    await mongoose.disconnect();
    console.log("✅ Disconnected from DB");
  } catch (err) {
    console.error("❌ Error deleting orders:", err);
  }
};

deleteOrders();
