const express = require("express");
require("dotenv").config();
const { google } = require("googleapis");
const cron = require("cron");
const app = express();



const oauth2Client = new google.auth.OAuth2(
  (CLIENT_ID = process.env.CLIENT_ID),
  (CLIENT_SECRET = process.env.CLIENT_SECRET),
  (REDIRECT_URL = process.env.REDIRECT_URI) // must match with the redirect url defined in the consent screen page 
);

const scopes = ["https://mail.google.com"];

const url = oauth2Client.generateAuthUrl({
  // 'online' (default) or 'offline' (gets refresh_token)
  access_type: "offline",

  // If you only need one scope you can pass it as a string
  scope: scopes,
});


// initial url -> you should make request here to test this out
app.get("/", async (req, res) => res.redirect(url));


// google auth callback url -> here we receive token
  app.get("/oauthcallback", async (req, res) => {
    const { tokens } = await oauth2Client.getToken(req.query.code);
    oauth2Client.setCredentials(tokens);
    trigger(oauth2Client);
    return res.json({ message: "Yeh! You are all set"});
  });



const trigger = async (auth) => {
  // setting up gmail client to work with
  const gmail = google.gmail({
    version: "v1",
    auth,
  });

  // getting all the unread threads
  const allUnreadThreads = await gmail.users.threads.list({
    userId: "me",
    q: "is:unread",
  });

  const NEW_LABEL = 'AUTO-REPLY2'

  // getting user profile
  const profile = await getProfileData(gmail);
  const labelId = await getLabelId(gmail, NEW_LABEL)

  console.log(labelId)

  // filtering the threads that don't have any reply and unread as well
  const filteredThreads = allUnreadThreads.data.threads.filter((thread) =>
    thread.snippet.includes(profile.emailAddress) ? null : thread
  );

  // need to loop through all the threads
// ---------------------------------------------- first working for only one thread (will loop all the threads and run the same code)


  // get the first message of the thread ( basically these threads will have only one message)
  const message = await gmail.users.messages.get({
    userId: 'me',
    id: filteredThreads[0].id
  })


  // extracting required header values from all the headers
  const requiredHeaders = ['Subject', 'From', 'Message-ID', 'To']
  const headers = message.data.payload.headers.filter((header) => requiredHeaders.some(req => req === header.name) ? header : null)


  // required fields to construct the reply email Reference ->>>> https://datatracker.ietf.org/doc/html/rfc2822#appendix-A.2
    const TO = headers.find(header => header.name === 'From').value
    const FROM = headers.find(header => header.name === 'To').value
    const IN_REPLY_TO = headers.find(header => header.name === 'Message-ID').value
    const REFERENCES = headers.find(header => header.name === 'Message-ID').value
    const first = FROM.split(' <')[0] + ': Personal Account'
    const second = '<' + FROM.split(' <')[1]
    const REPLY_TO = `"${first}" ${second}`
    const SUBJECT = 'Re: ' + headers.find(header => header.name === 'Subject').value

  // construct a new email
  const raw = `To: ${TO} \r\nFrom: ${FROM}\r\nSubject: ${SUBJECT}\r\nIn-Reply-To: ${IN_REPLY_TO}\r\nReferences: ${REFERENCES}\r\nReply-To: ${REPLY_TO}\r\n\r\n 'Will get to you back soon.'`


  const replyMessage = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      labelIds: [labelId],
      threadId: filteredThreads[0].id,
      // got to know what characters to replace from a stackoverflow answer
      raw: Buffer.from(raw).toString('base64url').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    },
  })
 
  const updatedThread = await modifyThread(gmail, replyMessage.data.threadId, labelId)
  console.log(updatedThread)
};


app.listen(process.env.PORT, () => {
  console.log("listening on port " + process.env.PORT);
});

// modify thread
const modifyThread = async  (gmail, threadId, labelId) => {
  const updatedThread = await gmail.users.threads.modify({
    userId: 'me',
    id: threadId,
    requestBody: {
      addLabelIds: [labelId],
      removeLabelIds: ['INBOX']
    }
  })
  return updatedThread;
}


// Handling label creation --> after this label exist definetely
  const getLabelId = async (gmail,newLabel, userId = 'me') => {
    // get all the labels
    const labels = await gmail.users.labels.list({
      userId: "me",
    });

    // check if label already exist
    const isLabelFound = labels.data.labels.find(
      (label) => label.name === newLabel
    );
    // creating label if not exist
    if (!isLabelFound) {
      // create one
      const createdLabel = await gmail.users.labels.create({
        userId: "me",
        requestBody: {
          name: newLabel,
          labelListVisibility: "labelShow",
          messageListVisibility: "show",
        },
      });
      console.log("label created");
      return createdLabel.data.id
    } else {
      console.log("label already exist");
      return isLabelFound.id;
    }
  };

  // function to get profile data
  const getProfileData = async(gmail, userId = 'me') => {
    const profileRes = await gmail.users.getProfile({
      userId: "me",
    });
    return profileRes.data;
  }