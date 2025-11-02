const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Admin = require("../model/adminModel");

exports.loginAdmin = async (req, res) => {
  const { email, password } = req.body;

  try {
    const admin = await Admin.findOne({ email });

    if (!admin) {
      return res.status(404).json({ message: "Admin not found" });
    }


    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign(
      { id: admin._id, role: "admin" },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.status(200).json({
      message: "Login successful",
      token,
      admin: {
        name: admin.name,
        email: admin.email,
      },
    });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// Add these new controller methods
exports.verifyAdmin = async (req, res) => {
  try {
    // Admin is already verified by the middleware
    res.status(200).json({
      success: true,
      admin: {
        id: req.admin._id,
        name: req.admin.name,
        email: req.admin.email
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: "Error verifying admin" 
    });
  }
};

exports.getAdminData = async (req, res) => {
  try {
    const adminId = req.params.id;
    
    // Verify the requested admin matches the authenticated admin
    if (adminId !== req.admin._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to access this data"
      });
    }

    const admin = await Admin.findById(adminId).select("-password");
    
    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin not found"
      });
    }

    res.status(200).json({
      success: true,
      data: admin
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching admin data"
    });
  }
};