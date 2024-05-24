require('dotenv').config();
const express = require('express');
const session = require('express-session');
const fs = require('fs');
const port = process.env.PORT || 3000;
const app = express();
const MongoStore = require('connect-mongo');
const bcrypt = require('bcrypt');
const saltRounds = 12;
const path = require('path');
const Joi = require("joi");
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { ObjectId } = require('mongodb'); // Added by Tanner from Chatgpt: chat.openai.com to save user information from form and repopulate the form with previously entered values.
var AWS = require("aws-sdk");


const expireTime =  1 * 60 * 60 * 1000; 


const mongodb_host = process.env.MONGODB_HOST;
const mongodb_user = process.env.MONGODB_USER;
const mongodb_password = process.env.MONGODB_PASSWORD;
const mongodb_database = process.env.MONGODB_DATABASE;
const mongodb_session_secret = process.env.MONGODB_SESSION_SECRET;

const node_session_secret = process.env.NODE_SESSION_SECRET;


var {database} = require('./databaseConnection');

const userCollection = database.db(mongodb_database).collection('users');
const droneCollection = database.db(mongodb_database).collection('drones');



app.use(express.urlencoded({extended: false}));
app.use(express.static(__dirname + "/images"));
app.use(express.static(__dirname + "/views"));
app.use(express.static(__dirname + "/css"));

app.set('view engine', 'ejs');


var mongoStore = MongoStore.create({
	mongoUrl: `mongodb+srv://${mongodb_user}:${mongodb_password}@${mongodb_host}/sessions`,
	crypto: {
		secret: mongodb_session_secret
	}
})

app.use(session({ 
    secret: node_session_secret,
	store: mongoStore, 
	saveUninitialized: false, 
	resave: true,
    cookie: {maxAge: expireTime }
}
));

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    }
});

AWS.config.region = 'us-west-1';

function signinCallback(googleUser) {
    var profile = googleUser.getBasicProfile();
    console.log('ID: ' + profile.getId()); // Do not send to your backend! Use an ID token instead.
    console.log('Name: ' + profile.getName());
    console.log('Email: ' + profile.getEmail());

    document.getElementById('userEmail').innerHTML = profile.getEmail();
    // document.getElementById('profile-name').innerHTML = profile.getName(); 

    AWS.config.credentials = new AWS.WebIdentityCredentials({
        RoleArn: 'arn:aws:iam::975049925657:role/asclepius',
        ProviderId: null, // this is null for Google
        WebIdentityToken: googleUser.getAuthResponse().id_token
    });

    // Obtain AWS credentials
    AWS.config.credentials.get(async function(){
        // Access AWS resources here.
        var accessKeyId = AWS.config.credentials.accessKeyId;
        var secretAccessKey = AWS.config.credentials.secretAccessKey;
        var sessionToken = AWS.config.credentials.sessionToken;

        // Update the URL to point to "userProfileInformation" endpoint
        const response = await fetch('http://localhost:3000/userProfileInfo', {
            method: 'POST',
            body: JSON.stringify({
                'AccessKeyId': accessKeyId,
                'SecretAccessKey': secretAccessKey,
                'SessionToken': sessionToken,
                'UserId': profile.getId(),
                'UserName': profile.getName(),
                'UserEmail': profile.getEmail()
            }),
            headers: {
                'Content-Type': 'application/json'
            }
        });

        // Handle the response from the server
        const myJson = await response.json(); //extract JSON from the http response
        console.log(myJson);

        // Optionally, redirect to the user profile information page if needed
        // res.redirect("userProfileInformation");
            window.location.href = '/userProfileInformation';
    });
}


function signOut() {
    var auth2 = gapi.auth2.getAuthInstance();
    auth2.signOut().then(function () {
        console.log('User signed out.');
    });
}



app.get('/login', (req,res) => {
    var errorMessage = req.session.errorMessage || '';
    req.session.errorMessage = '';
    res.render("login", {errorMessage: errorMessage});

});

// Contains GPT code to help with the password reset with crypto tokens
app.post('/forgotPassword', async (req, res) => {
    const { email } = req.body;
    const user = await userCollection.findOne({ email });
    if (!user) {
        req.session.errorMessage = 'User with this email does not exist';
        res.redirect('/login');
        return;
    }

    // ChatGPT provided the following code to generate a unique token (hexa) for password reset
    const token = crypto.randomBytes(20).toString('hex');
    user.resetPasswordToken = token;
    user.resetPasswordExpires = Date.now() + 3600000; // Token expires in 1 hour

    await userCollection.updateOne({ email }, { $set: { resetPasswordToken: token, resetPasswordExpires: user.resetPasswordExpires } });


    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Password Reset',
        text: `You are receiving this because you (or someone else) have requested the reset of the password for your account.\n\n`
            + `Please click on the following link, or paste this into your browser to complete the process:\n\n`
            + `http://${req.headers.host}/reset/${token}\n\n`
            + `If you did not request this, please ignore this email and your password will remain unchanged.\n`
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.log(error);
        } else {
            console.log('Email sent: ' + info.response);
        }
    });

    req.session.successMessage = 'Password reset link has been sent to your email';
    res.redirect('/login');
});

// Route for rendering password reset form
// Generated by chatGPT: chat.openai.com 5/17/2024
app.get('/reset/:token', async (req, res) => {
    const user = await userCollection.findOne({
        resetPasswordToken: req.params.token,
        resetPasswordExpires: { $gt: Date.now() }
    });
    if (!user) {
        req.session.errorMessage = 'Password reset token is invalid or has expired';
        res.redirect('/login');
        return;
    }
    res.render('reset', { token: req.params.token });
});

// Route for processing password reset
// Generated by chatGPT: chat.openai.com 5/17/2024
app.post('/reset/:token', async (req, res) => {
    const user = await userCollection.findOne({
        resetPasswordToken: req.params.token,
        resetPasswordExpires: { $gt: Date.now() }
    });
    if (!user) {
        req.session.errorMessage = 'Password reset token is invalid or has expired';
        res.redirect('/login');
        return;
    }
    const { password } = req.body;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    await userCollection.updateOne({ email: user.email }, { $set: { password: hashedPassword, resetPasswordToken: null, resetPasswordExpires: null } });
    req.session.successMessage = 'Password has been reset successfully';
    res.redirect('/login');
});

app.get('/forgotPassword', (req,res) => {
    res.render("forgotPassword");
});

app.get('/createUser', (req,res) => {
	res.render("createUser");
   });



   
app.get('/userType', (req,res) => {
	res.render("userType");
   });

      
app.get('/createOrganization', (req,res) => {
	res.render("createOrganization");
   });

app.post('/submitUser', async (req,res) => {
    var email = req.body.email;
    var username = req.body.username;
    var password = req.body.password;

	const schema = Joi.object(
		{
            email: Joi.string().email().required(),
			username: Joi.string().alphanum().max(20).required(),
			password: Joi.string().max(20).required()
		});
	
	const validationResult = schema.validate({email, username, password});
	if (validationResult.error != null) {
	   console.log(validationResult.error);
	   res.redirect("/createUser");
	   return;
   }

    var hashedPassword = await bcrypt.hash(password, saltRounds);
	
	var result = await userCollection.insertOne({email: email, username: username, password: hashedPassword, user_type: "user"});
	console.log("Inserted user");

    req.session.authenticated = true;
    req.session.username = result.username;
    //Tanner created req.session.userId = result.insertedId; with chatgpt: chat.openai.com
    req.session.userId = result.insertedId;
    req.session.cookiemaxAge = expireTime;

    res.redirect("/userProfileInfo");

});

app.post('/submitOrg', async (req,res) => {
    var email = req.body.email;
    var username = req.body.username;
    var password = req.body.password;

	const schema = Joi.object(
		{
            email: Joi.string().email().required(),
			username: Joi.string().alphanum().max(20).required(),
			password: Joi.string().max(20).required()
		});
	
	const validationResult = schema.validate({email, username, password});
	if (validationResult.error != null) {
	   console.log(validationResult.error);
	   res.redirect("/createUser");
	   return;
   }

    var hashedPassword = await bcrypt.hash(password, saltRounds);
	
	var result = await userCollection.insertOne({email: email, username: username, password: hashedPassword, user_type: "user"});
	console.log("Inserted user");

    req.session.authenticated = true;
    req.session.username = result.username;
    //Tanner created req.session.userId = result.insertedId; with chatgpt: chat.openai.com
    req.session.userId = result.insertedId;
    req.session.cookiemaxAge = expireTime;

    res.redirect("/orgProfileInfo");

});

app.post('/loggingin', async (req, res) => {
    var email = req.body.email; 
    var password = req.body.password;

    const schema = Joi.object({
        email: Joi.string().email().required(),
        password: Joi.string().required()
    });

    const { error } = schema.validate({ email, password });

    if (error) {
        console.log(error);
        req.session.errorMessage = 'Invalid email or password';
        res.redirect("/login");
        return;
    }
    const result = await userCollection.find({email: email}).project({username: 1, password: 1, user_type: 1, _id: 1}).toArray();

    // const result = await userCollection.findOne({ email });

    console.log(result);

    if (result.length != 1) {
		console.log("user not found");
		res.redirect("/login");
		return;
	}

    if (!result) {
        req.session.errorMessage = 'Invalid email or password';
        res.redirect("/login");
        return;
    }

    if (await bcrypt.compare(password, result[0].password)) {
        console.log("correct password");
        req.session.authenticated = true;
        req.session.username = result[0].username;
        req.session.userId = result[0]._id;
        req.session.user_type = result[0].user_type;
        req.session.cookie.maxAge = expireTime;

        res.redirect('/userProfileInfo');
    } else {
        req.session.errorMessage = 'Invalid email or password';
        res.redirect("/login");
    }
});
app.get('/loggedin', (req,res) => {
    if (!req.session.authenticated) {
        res.redirect('/login');
    }
    res.render('test');
});

app.get('/', (req, res) => {
    res.render('landing');
});

app.get('/map', (req, res) => {
    res.render('map');
});

// Tanner Added userProfileInfo and userInformation
// Used chatgpt to help include any previously user submited data. Chatgpt: chat.openai.com
app.get('/userProfileInfo', async (req, res) => {
    try {
        const userId = req.session.userId;
        const user = await userCollection.findOne({ _id: new ObjectId(userId)});
        res.render('userProfileInformation', { user });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/orgProfileInfo', async (req, res) => {
    try {
        const userId = req.session.userId;
        const user = await userCollection.findOne({ _id: new ObjectId(userId)});
        res.render('orgProfileInformation', { user });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Used ChatGpt to help accept form submission and editing. Chatgpt: chat.openai.com
app.post('/userInformation', async (req, res) => {
    try {
        const { firstName, lastName, email, address, city, province, postalCode, phone, DOB, age, gender, careCard, doctor, medHistory, medication, allergies } = req.body;

        const userId = req.session.userId;
        await userCollection.updateOne(
            { _id:  new ObjectId(userId) },
            { $set: { firstName, lastName, email, address, city, province, postalCode, phone, DOB, age, gender, careCard, doctor, medHistory, medication, allergies }
        });

        // Redirect the user to a success page or back to the profile page
        res.redirect('/userProfileInfo');
    } catch (error) {
        console.error('Error:', error);
        res.status(500).send('Internal Server Error');
    }
})

app.post('/orgInformation', async (req, res) => {
    try {
        const { firstName, lastName, email, address, city, province, postalCode, phone, DOB, age, gender, careCard, doctor, medHistory, medication, allergies } = req.body;

        const userId = req.session.userId;
        await userCollection.updateOne(
            { _id:  new ObjectId(userId) },
            { $set: { firstName, lastName, email, address, city, province, postalCode, phone, DOB, age, gender, careCard, doctor, medHistory, medication, allergies }
        });

        // Redirect the user to a success page or back to the profile page
        res.redirect('/orgProfileInfo');
    } catch (error) {
        console.error('Error:', error);
        res.status(500).send('Internal Server Error');
    }
})

app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Error destroying session:', err);
            res.status(500).send('Internal Server Error');
            return;
        }
        res.redirect('/login');
    });
    signOut();
});

app.get('/droneList', async (req, res) => {
    try {
        const drones = await droneCollection.find().toArray();
        res.render('droneList', { drones: drones });
    } catch (error) {
        console.log(error);
        res.status(500).send('Internal Server Error');
    }
});


app.get('/addDrone', (req, res) => {
    res.render('addDrone');
});
app.post('/addingDrone', async (req, res) => {
    var name = req.body.name;
    var status = req.body.status;
    var location = req.body.location;
    var description = req.body.description;

	const schema = Joi.object(
		{
            name: Joi.string().required(),
			status: Joi.string().alphanum().max(20).required(),
			location: Joi.string().max(20).required(),
            description : Joi.string().required()
		});
	
	const validationResult = schema.validate({name, status, location, description});
	if (validationResult.error != null) {
	   console.log(validationResult.error);
	   res.redirect("/addDrone");
	   return;
   }

	
	var result = await droneCollection.insertOne({name: name, status: status, location: location, description: description, user_type: "drone"});
	console.log("Inserted drone");

    // req.session.authenticated = true;
    req.session.name = result.name;
    //Tanner created req.session.userId = result.insertedId; with chatgpt: chat.openai.com
    // req.session.userId = result.insertedId;
    req.session.cookiemaxAge = expireTime;

    res.redirect("/addDrone");
})

// REMOVE AT END
app.get('/test', (req, res) => {
    res.render('test');
});

app.get('/orgDashboard', (req, res) => {
    res.render('orgDashboard');
});

// import {v2 as cloudinary} from 'cloudinary';

// (async function() {

//     // Configuration
//     cloudinary.config({ 
//         cloud_name: CLOUDINARY_CLOUD_NAME, 
//         api_key: CLOUDINARY_CLOUD_KEY, 
//         api_secret:CLOUDINARY_CLOUD_SECRET // Click 'View Credentials' below to copy your API secret
//     });
    
//     // Upload an image
//     const uploadResult = await cloudinary.uploader.upload("https://res.cloudinary.com/demo/image/upload/getting-started/shoes.jpg", {
//         public_id: "shoes"
//     }).catch((error)=>{console.log(error)});
    
//     console.log(uploadResult);
    
//     // Optimize delivery by resizing and applying auto-format and auto-quality
//     const optimizeUrl = cloudinary.url("shoes", {
//         fetch_format: 'auto',
//         quality: 'auto'
//     });
    
//     console.log(optimizeUrl);
    
//     // Transform the image: auto-crop to square aspect_ratio
//     const autoCropUrl = cloudinary.url("shoes", {
//         crop: 'auto',
//         gravity: 'auto',
//         width: 500,
//         height: 500,
//     });
    
//     console.log(autoCropUrl);    
// })();

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}/`);
});