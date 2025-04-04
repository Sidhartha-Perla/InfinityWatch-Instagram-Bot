const axios = require('axios');
const sharp = require('sharp');
const FormData = require('form-data');
require("dotenv").config();

/**
 * Creates a collage from an array of image URLs and uploads it to ImgBB without creating local files
 * @param {string[]} imageUrls - Array of image URLs
 * @param {string} imgbbApiKey - Your ImgBB API key
 * @param {Object} options - Optional parameters
 * @param {number} options.maxWidth - Maximum width of the collage (default: 1080)
 * @param {number} options.padding - Padding between images in pixels (default: 10)
 * @param {string} options.backgroundColor - Background color (default: 'white')
 * @param {number} options.columns - Number of columns in the grid (if undefined, will be calculated)
 * @returns {Promise<string>} - URL of the uploaded image on ImgBB
 */
async function createCollageAndUpload(imageUrls,options = {}) {
  if (!imageUrls || !imageUrls.length) {
    throw new Error('No image URLs provided');
  }
  
  const imgbbApiKey = process.env.IMGBB_API_KEY;

  const {
    maxWidth = 1080,
    padding = 5,
    backgroundColor = 'white',
    columns: userDefinedColumns,
    quality = 90
  } = options;

  try {
    console.log('Downloading images...');
    // Download all images as buffers
    const imageBuffers = await Promise.all(imageUrls.map(async (url) => {
      const response = await axios.get(url, { responseType: 'arraybuffer' });
      return response.data;
    }));
    
    // Get dimensions and orientation of each image
    const imageInfos = await Promise.all(imageBuffers.map(async (buffer) => {
      // Auto-rotate images based on EXIF orientation
      const rotatedBuffer = await sharp(buffer)
        .rotate() // Auto-rotate based on EXIF orientation
        .toBuffer();
      
      // Get dimensions after rotation
      const rotatedMetadata = await sharp(rotatedBuffer).metadata();
      
      return {
        buffer: rotatedBuffer,
        width: rotatedMetadata.width,
        height: rotatedMetadata.height,
        aspectRatio: rotatedMetadata.width / rotatedMetadata.height
      };
    }));

    // Calculate average aspect ratio (ensuring it's between 4:5 and 1:1)
    const totalAspectRatio = imageInfos.reduce((sum, img) => sum + img.aspectRatio, 0);
    let avgAspectRatio = totalAspectRatio / imageInfos.length;
    
    // Ensure aspect ratio is between 4:5 (0.8) and 1:1
    avgAspectRatio = Math.max(0.8, Math.min(1, avgAspectRatio));
    
    // Determine optimal grid layout
    const imageCount = imageInfos.length;
    const columns = userDefinedColumns || Math.min(3, Math.ceil(Math.sqrt(imageCount)));
    const rows = Math.ceil(imageCount / columns);
    
    // Calculate individual image dimensions
    const imageWidth = Math.floor((maxWidth - (padding * (columns - 1))) / columns);
    const imageHeight = Math.floor(imageWidth / avgAspectRatio);
    
    console.log(`Using average aspect ratio: ${avgAspectRatio.toFixed(2)} (${imageWidth}x${imageHeight})`);
    
    // Resize all images to uniform dimensions, with proper cropping to maintain aspect ratio
    const resizedImageBuffers = await Promise.all(imageInfos.map(async (img) => {
      return await sharp(img.buffer)
        .resize({
          width: imageWidth, 
          height: imageHeight,
          fit: 'cover', // This crops the image to fill the dimensions without adding padding
          position: 'center' // Center the crop
        })
        .jpeg({ quality })
        .toBuffer();
    }));

    // Calculate final canvas dimensions
    const canvasWidth = (imageWidth * columns) + (padding * (columns - 1));
    const canvasHeight = (imageHeight * rows) + (padding * (rows - 1));
    
    console.log(`Creating collage with ${columns} columns and ${rows} rows (${canvasWidth}x${canvasHeight})`);

    // Create canvas
    const canvas = sharp({
      create: {
        width: canvasWidth,
        height: canvasHeight,
        channels: 3, // RGB (no alpha channel)
        background: backgroundColor
      }
    });

    // Create composite array for placing images on canvas
    const compositeArray = [];
    for (let i = 0; i < resizedImageBuffers.length; i++) {
      const row = Math.floor(i / columns);
      const col = i % columns;
      
      const left = col * (imageWidth + padding);
      const top = row * (imageHeight + padding);
      
      compositeArray.push({
        input: resizedImageBuffers[i],
        left,
        top
      });
    }

    // Generate the collage
    const collageBuffer = await canvas
      .composite(compositeArray)
      .jpeg({ quality })
      .toBuffer();
    
    console.log('Collage created, uploading to ImgBB...');
    
    // Upload to ImgBB
    const formData = new FormData();
    formData.append('image', collageBuffer.toString('base64'));
    
    const uploadResponse = await axios.post(`https://api.imgbb.com/1/upload?key=${imgbbApiKey}`, formData);

    if (uploadResponse.data && uploadResponse.data.data) {
      console.log('Upload successful!');
      return uploadResponse.data.data.url;
    } else {
      throw new Error('Upload failed: Invalid response from ImgBB');
    }
  } catch (error) {
    console.error('Error:', error.message);
    throw error;
  }
}

module.exports = { createCollageAndUpload };
/*
const imageUrls = [
  'https://truesnap.s3.amazonaws.com/129615-097ef1f319c3ff8d065ee46b3a54047d661ac8e4b63075416d3a402ff157462c.jpg',
  'https://truesnap.s3.amazonaws.com/338280-edb8ff57b31a741b95a4e6b1c4151b5c8cc219fb69756ca91505448f111be8e4.jpg',
  'https://truesnap.s3.amazonaws.com/283704-004300895d9cce4856d72bae06730cc12e630c199b37eaeaac54159e22de31da.jpg',
  'https://truesnap.s3.amazonaws.com/157288-e72cc87384dc144a1c6c0d0ddaa6dae047f4e26419189945e03cf851c7fbc619.jpg',
  'https://truesnap.s3.amazonaws.com/100499-7848351121cd69bc596bf31bbb750bfa8ca67844ba3d08f796c0fb76878f2e03.jpg',
  'https://truesnap.s3.amazonaws.com/228885-f4189430b15d443f0d4f4d1b6cda1035dcc9c64f1065db28ed9652471a131d26.jpg',
  'https://truesnap.s3.amazonaws.com/223181-9c7ffbaf4eff4fea11fa5c98d9c7e74959fd3d1cebf0991c67bf9a3d61fe567a.jpg',
  'https://truesnap.s3.amazonaws.com/249763-a213c1867316a02a70f209e99a27241536b26434857c0203518be6e12a3618b3.jpg',
  'https://truesnap.s3.amazonaws.com/thumbnail-297484-d8ceaad31667d95bbd0e218797f8384779c33f980af60246e1c9958efeaa848c.jpg'
];

createCollageAndUpload(imageUrls)
  .then(url => {
    console.log('ImgBB URL:', url);
  })
  .catch(err => {
    console.error('Failed to create and upload collage:', err);
  });
*/
