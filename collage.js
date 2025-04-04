const axios = require('axios');
const sharp = require('sharp');
const FormData = require('form-data');
require("dotenv").config();

async function createAndUploadCollage(imageUrls, options = {}) {
    if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
      throw new Error('Image URLs should not be empty');
    }
    
    const imgbbApiKey = process.env.IMGBB_API_KEY;
    if (!imgbbApiKey) {
      throw new Error('ImgBB API key is required');
    }
  
    // default options
    const collageOptions = {
      width: options.width || 400,
      height: options.height || 500,
      columns: options.columns || Math.ceil(Math.sqrt(imageUrls.length)),
      backgroundColor: options.backgroundColor || '#000000',
      spacing: options.spacing || 2
    };
    console.log(imageUrls);
    try {
      // Download all images
      console.log('Downloading images...');
      const imageBuffers = await Promise.all(
        imageUrls.map(async (url) => {
          const response = await axios.get(url, { responseType: 'arraybuffer' });
          return Buffer.from(response.data);
        })
      );
  
      // Calculate rows and columns
      const columns = collageOptions.columns;
      const rows = Math.ceil(imageUrls.length / columns);
      
      // Calculate cell dimensions
      const cellWidth = Math.floor((collageOptions.width - (columns + 1) * collageOptions.spacing) / columns);
      const cellHeight = Math.floor((collageOptions.height - (rows + 1) * collageOptions.spacing) / rows);
  
      // Process each image and create input objects for the composite function
      console.log('Processing images for collage...');
      const compositeInputs = await Promise.all(
        imageBuffers.map(async (buffer, index) => {
          // Resize image to fit cell
          const resizedImageBuffer = await sharp(buffer)
            .rotate()
            .resize({
              width: cellWidth,
              height: cellHeight,
              fit: 'contain',
              background: { r: 0, g: 0, b: 0, alpha: 0 }
            })
            .toBuffer();
  
          //position in the grid
          const row = Math.floor(index / columns);
          const col = index % columns;
          const left = collageOptions.spacing + col * (cellWidth + collageOptions.spacing);
          const top = collageOptions.spacing + row * (cellHeight + collageOptions.spacing);
  
          return {
            input: resizedImageBuffer,
            top,
            left
          };
        })
      );
  
      //Create collage
      console.log('Creating collage...');
      const collageBuffer = await sharp({
        create: {
          width: collageOptions.width,
          height: collageOptions.height,
          channels: 4,
          background: collageOptions.backgroundColor
        }
      })
        .composite(compositeInputs)
        .jpeg({ quality: 90 })
        .toBuffer();
  
      // Upload
      console.log('Uploading collage to ImgBB...');
      const formData = new FormData();
      formData.append('image', collageBuffer.toString('base64'));
  
      const uploadResponse = await axios.post(`https://api.imgbb.com/1/upload?key=${imgbbApiKey}`, formData, {
        headers: formData.getHeaders()
      });
  
      console.log('Collage uploaded successfully!');
      return uploadResponse.data.data.url;
    } catch (error) {
      console.error('Error in createAndUploadCollage:', error.message);
      throw error;
    }
  }

module.exports = {createAndUploadCollage};


/*
const imageUrls = [
  'https://truesnap.s3.amazonaws.com/129615-097ef1f319c3ff8d065ee46b3a54047d661ac8e4b63075416d3a402ff157462c.jpg',
  'https://truesnap.s3.amazonaws.com/338280-edb8ff57b31a741b95a4e6b1c4151b5c8cc219fb69756ca91505448f111be8e4.jpg',
  'https://truesnap.s3.amazonaws.com/283704-004300895d9cce4856d72bae06730cc12e630c199b37eaeaac54159e22de31da.jpg',
  'https://truesnap.s3.amazonaws.com/157288-e72cc87384dc144a1c6c0d0ddaa6dae047f4e26419189945e03cf851c7fbc619.jpg',
  'https://truesnap.s3.amazonaws.com/100499-7848351121cd69bc596bf31bbb750bfa8ca67844ba3d08f796c0fb76878f2e03.jpg',
  'https://truesnap.s3.amazonaws.com/100499-7848351121cd69bc596bf31bbb750bfa8ca67844ba3d08f796c0fb76878f2e03.jpg',
  'https://truesnap.s3.amazonaws.com/100499-7848351121cd69bc596bf31bbb750bfa8ca67844ba3d08f796c0fb76878f2e03.jpg',
  'https://truesnap.s3.amazonaws.com/100499-7848351121cd69bc596bf31bbb750bfa8ca67844ba3d08f796c0fb76878f2e03.jpg',
  'https://truesnap.s3.amazonaws.com/100499-7848351121cd69bc596bf31bbb750bfa8ca67844ba3d08f796c0fb76878f2e03.jpg',
];

const options = {
  width: 400,
  height: 500,
  backgroundColor: '#f0f0f0',
};

//const IMGBB_API_KEY = 'd1a121c27f7dd3d619373dd3d0553975';

createAndUploadCollage(imageUrls, options)
  .then(response => {
    console.log('ImgBB URL:', response.data.url);
  })
  .catch(err => {
    console.error('Failed to create and upload collage:', err);
  });
*/