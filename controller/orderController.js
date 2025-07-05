const Order = require('../model/Order');

// Helper function for error handling
const handleErrorResponse = (res, error, context) => {
  console.error(`Error in ${context}:`, error);
  res.status(500).json({
    success: false,
    message: `Failed to ${context}`,
    error: error.message
  });
};

// Create a new order
exports.createOrder = async (req, res) => {
  try {
    const { fullName, birthday, address, phone, email, idImage, plan, price } = req.body;

    // Create new order
    const newOrder = await Order.create({
      fullName,
      birthday,
      address,
      phone,
      email,
      idImage,
      plan,
      price,
      status: 'Pending'
    });

    res.status(201).json({
      success: true,
      data: newOrder
    });
  } catch (error) {
    handleErrorResponse(res, error, 'create order');
  }
};

// Get all orders
exports.getAllOrders = async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.status(200).json({
      success: true,
      count: orders.length,
      data: orders
    });
    
  } catch (error) {
    handleErrorResponse(res, error, 'fetch orders');
  }
};

// Get single order
exports.getOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }
    res.status(200).json({
      success: true,
      data: order
    });
  } catch (error) {
    handleErrorResponse(res, error, 'fetch order');
  }
};

// Update order status
exports.updateOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, paymentMethod, transactionReference } = req.body;

    // Validate status
    const validStatuses = ['Pending', 'Processing', 'Completed', 'Cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status value'
      });
    }

    // Prepare update
    const updateData = { status };
    if (status === 'Completed') {
      if (!paymentMethod) {
        return res.status(400).json({
          success: false,
          message: 'Payment method is required when completing an order'
        });
      }
      updateData.paymentMethod = paymentMethod;
      updateData.paymentConfirmedAt = new Date();
      updateData.transactionReference = transactionReference;
    }

    const updatedOrder = await Order.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!updatedOrder) {
      return res.status(404).json({ 
        success: false,
        message: "Order not found" 
      });
    }

    res.status(200).json({
      success: true,
      data: updatedOrder
    });
  } catch (error) {
    console.error('Update error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during update'
    });
  }
};

// Delete order (optional)
exports.deleteOrder = async (req, res) => {
  try {
    const order = await Order.findByIdAndDelete(req.params.id);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }
    res.status(200).json({
      success: true,
      message: 'Order deleted successfully'
    });
  } catch (error) {
    handleErrorResponse(res, error, 'delete order');
  }
};