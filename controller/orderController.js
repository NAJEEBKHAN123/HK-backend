const Order = require("../model/Order");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// Helper function for error handling
const handleErrorResponse = (res, error, context) => {
  console.error(`❌ Error in ${context}:`, error);
  res.status(500).json({
    success: false,
    message: `Failed to ${context}`,
    error: error.message
  });
};

// Create Order
exports.createOrder = async (req, res) => {
  try {
    // Validate content type
    if (!req.is('application/json')) {
      return res.status(415).json({ 
        success: false,
        message: 'Content-Type must be application/json' 
      });
    }

    const { fullName, birthday, address, phone, email, idImage, plan, price } = req.body;

    // Validate required fields
    const requiredFields = { fullName, birthday, address, phone, email, idImage, plan, price };
    const missingFields = Object.entries(requiredFields)
      .filter(([_, value]) => !value)
      .map(([key]) => key);

    if (missingFields.length > 0) {
      return res.status(400).json({ 
        success: false,
        message: 'Missing required fields',
        missingFields 
      });
    }

    // Create Order
    const newOrder = await Order.create({
      fullName,
      birthday,
      address,
      phone,
      email,
      idImage,
      plan,
      price: Number(price),
      status: 'pending' // Default status
    });

    // Create Stripe Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: "eur",
          product_data: {
            name: `${plan} Plan`,
            description: `Order for ${fullName}`
          },
          unit_amount: Math.round(Number(price) * 100) // Ensure integer
        },
        quantity: 1
      }],
      mode: "payment",
      success_url: `http://localhost:5173/success?orderId=${newOrder._id}`,
      cancel_url: `http://localhost:5173/cancel`,
 
      metadata: { orderId: newOrder._id.toString() }
    });

    res.status(201).json({ 
      success: true,
      message: "Order created successfully",
      checkoutUrl: session.url,
      order: newOrder
    });

  } catch (error) {
    handleErrorResponse(res, error, 'create order');
  }
};

// Get All Orders
exports.getAllOrders = async (req, res) => {
  try {
    const orders = await Order.find()
      .sort({ createdAt: -1 })
      .select('-__v'); // Exclude version key

    res.status(200).json({
      success: true,
      count: orders.length,
      message: orders.length ? "Orders fetched successfully" : "No orders found",
      data: orders
    });
  } catch (error) {
    handleErrorResponse(res, error, 'fetch orders');
  }
};

// Get Single Order
exports.getOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .select('-__v');

    if (!order) {
      return res.status(404).json({ 
        success: false,
        message: "Order not found" 
      });
    }

    res.status(200).json({
      success: true,
      message: "Order fetched successfully",
      data: order
    });
  } catch (error) {
    handleErrorResponse(res, error, 'fetch order');
  }
};

// Update Order
exports.updateOrder = async (req, res) => {
  try {
    // Validate content type
    if (!req.is('application/json')) {
      return res.status(415).json({ 
        success: false,
        message: 'Content-Type must be application/json' 
      });
    }

    const { id } = req.params;
    const updates = req.body;

    // Validate allowed updates
    const allowedUpdates = ['status', 'address', 'phone', 'email'];
    const invalidUpdates = Object.keys(updates).filter(
      key => !allowedUpdates.includes(key)
    );

    if (invalidUpdates.length > 0) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid update fields',
        invalidFields: invalidUpdates
      });
    }

    const updatedOrder = await Order.findByIdAndUpdate(
      id,
      updates,
      { 
        new: true,
        runValidators: true 
      }
    ).select('-__v');

    if (!updatedOrder) {
      return res.status(404).json({ 
        success: false,
        message: "Order not found" 
      });
    }

    res.status(200).json({
      success: true,
      message: "Order updated successfully",
      data: updatedOrder
    });
  } catch (error) {
    handleErrorResponse(res, error, 'update order');
  }
};

// Delete Order (optional)
exports.deleteOrder = async (req, res) => {
  try {
    const order = await Order.findByIdAndDelete(req.params.id);

    if (!order) {
      return res.status(404).json({ 
        success: false,
        message: "Order not found" 
      });
    }

    res.status(200).json({
      success: true,
      message: "Order deleted successfully"
    });
  } catch (error) {
    handleErrorResponse(res, error, 'delete order');
  }
};