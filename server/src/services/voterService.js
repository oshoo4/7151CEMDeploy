const dotenv = require('dotenv');
dotenv.config();

const voterRepository = require('../repositories/voterRepository');
const faceApiService = require('./faceApiService');
const blobStorageService = require('./blobStorageService');
const voterElectionStatusRepository = require('../repositories/voterElectionStatusRepository');
const electionRepository = require('../repositories/electionRepository');
const jwt = require('jsonwebtoken');

class VoterService {

  async registerVoter(voterData, imageFile) {
    let azurePersonId, photoUrl;
    
    try {
      [azurePersonId, photoUrl] = await Promise.all([
        faceApiService.enrollFace(imageFile.buffer),
        blobStorageService.uploadImage(imageFile.buffer, imageFile.originalname)
      ]);
    } catch (error) {
      throw new Error('Failed to process voter image with Azure services.');
    }

    if (!azurePersonId || !photoUrl) {
      throw new Error('Failed to process voter image with Azure services.');
    }

    const fullVoterData = {
      ...voterData,
      AzurePersonID: azurePersonId,
      PhotoUrl: photoUrl,
    };

    return await voterRepository.create(fullVoterData);
  }

  async authenticateVoter(publicVoterId, imageBuffer) {
    const voter = await voterRepository.findByPublicVoterID(publicVoterId);
    if (!voter) { throw new Error('Voter not found.'); }
    
    const activeElection = await electionRepository.findActive();
    if (!activeElection) {
      throw new Error('No active election is currently open for voting.');
    }
    const activeElectionId = activeElection.ElectionID;
    
    const hasVoted = await voterElectionStatusRepository.hasVoted(voter.VoterID, activeElectionId);
    if (hasVoted) {
      throw new Error('This voter has already cast their ballot for this election.');
    }

    const azurePersonIdAsString = String(voter.AzurePersonID).toLowerCase();
    const verificationResult = await faceApiService.verifyFace(imageBuffer, azurePersonIdAsString);
    if (!verificationResult.isIdentical || verificationResult.confidence < 0.75) {
      throw new Error('Facial verification failed. Confidence too low.');
    }

    const payload = { voterId: voter.VoterID, electionId: activeElectionId };
    const votingToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '15m' });

    return { 
      success: true, 
      message: 'Verification successful. Proceed to ballot.',
      voter: { FullName: voter.FullName },
      votingToken: votingToken, 
      electionId: payload.electionId,
      verificationResult: verificationResult
    };
  }
}

module.exports = new VoterService();



// const voterRepository = require('../repositories/voterRepository');
// const faceApiService = require('./faceApiService');
// const blobStorageService = require('./blobStorageService'); // Needed for PhotoUrl
// const voterElectionStatusRepository = require('../repositories/voterElectionStatusRepository'); // Needed for checking vote status
// const electionRepository = require('../repositories/electionRepository');
// const jwt = require('jsonwebtoken');

// class VoterService {
//   /**
//    * Orchestrates the registration of a new voter using the hybrid workflow.
//    * This method uses the image buffer captured by react-webcam.
//    * @param {object} voterData - Personal details of the voter (e.g., FullName, DateOfBirth).
//    * @param {object} imageFile - The file object from multer, containing the image buffer.
//    * @returns {Promise<object>} The newly created voter record from the database.
//    */
//   async registerVoter(voterData, imageFile) {
//     // Use Promise.all to perform Face API enrolment and Blob Storage upload concurrently
//     const [azurePersonId, photoUrl] = await Promise.all([
//       faceApiService.enrollFace(imageFile.buffer),
//       blobStorageService.uploadImage(imageFile.buffer, imageFile.originalname)
//     ]);

//     if (!azurePersonId || !photoUrl) {
//       throw new Error('Failed to process voter image with Azure services.');
//     }

//     const fullVoterData = {
//       ...voterData,
//       AzurePersonID: azurePersonId,
//       PhotoUrl: photoUrl,
//     };

//     // Save the complete voter record to our database
//     return await voterRepository.create(fullVoterData);
//   }

//   /**
//    * Orchestrates the authentication of a voter using the hybrid workflow.
//    * This method uses the image buffer captured by react-webcam after the liveness check.
//    * @param {string} publicVoterId - The public ID of the voter to authenticate.
//    * @param {Buffer} imageBuffer - The live photo of the voter as a binary buffer.
//    * @returns {Promise<object>} An object indicating success and containing the voting token.
//    */
//   async authenticateVoter(publicVoterId, imageBuffer) {
//     // 1. Find the voter in the local database
//     const voter = await voterRepository.findByPublicVoterID(publicVoterId);
//     if (!voter) { throw new Error('Voter not found.'); }
    
//     // --- THIS IS THE FIX ---
//     // 2. Dynamically find the currently active election from the database.
//     const activeElection = await electionRepository.findActive();
//     if (!activeElection) {
//       throw new Error('No active election is currently open for voting.');
//     }
//     const activeElectionId = activeElection.ElectionID;
//     // ----------------------
    
//     const hasVoted = await voterElectionStatusRepository.hasVoted(voter.VoterID, activeElectionId);
//     if (hasVoted) {
//       throw new Error('This voter has already cast their ballot for this election.');
//     }

//     // 3. Verify their live face against their stored biometric ID
//     const azurePersonIdAsString = String(voter.AzurePersonID).toLowerCase();
//     const verificationResult = await faceApiService.verifyFace(imageBuffer, azurePersonIdAsString);
//     if (!verificationResult.isIdentical || verificationResult.confidence < 0.75) {
//       throw new Error('Facial verification failed. Confidence too low.');
//     }

//     // 4. If verification is successful, create a short-lived "voting token"
//     const payload = { voterId: voter.VoterID, electionId: activeElectionId };
//     const votingToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '15m' });

//     // 5. Return all necessary data to the front-end
//     return { 
//       success: true, 
//       message: 'Verification successful. Proceed to ballot.',
//       voter: { FullName: voter.FullName },
//       votingToken: votingToken,
//       electionId: payload.electionId
//     };
//   }
// }

// module.exports = new VoterService();
