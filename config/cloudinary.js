const { v2: cloudinary } = require('cloudinary');
const path = require('path');

const requiredVariables = [
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
];

const isCloudinaryConfigured = () => requiredVariables.every((key) => Boolean(process.env[key]));

const ensureCloudinaryConfigured = () => {
  if (isCloudinaryConfigured()) return;

  const missing = requiredVariables.filter((key) => !process.env[key]);
  const error = new Error(`Cloudinary chua duoc cau hinh: ${missing.join(', ')}`);
  error.statusCode = 503;
  throw error;
};

if (isCloudinaryConfigured()) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

const uploadImageBuffer = (file) => {
  ensureCloudinaryConfigured();

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'candletshop/products',
        resource_type: 'image',
        use_filename: true,
        unique_filename: true,
        overwrite: false,
      },
      (error, result) => {
        if (error) return reject(error);
        return resolve(result);
      },
    );

    stream.end(file.buffer);
  });
};

const getCloudinaryPublicId = (fileUrl) => {
  if (!fileUrl || typeof fileUrl !== 'string' || !isCloudinaryConfigured()) return null;

  try {
    const url = new URL(fileUrl);
    if (url.hostname !== 'res.cloudinary.com') return null;

    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== process.env.CLOUDINARY_CLOUD_NAME) return null;

    const uploadIndex = parts.indexOf('upload');
    if (uploadIndex === -1) return null;

    const versionIndex = parts.findIndex((part, index) => index > uploadIndex && /^v\d+$/.test(part));
    const publicIdParts = parts.slice(versionIndex === -1 ? uploadIndex + 1 : versionIndex + 1);
    if (publicIdParts.length === 0) return null;

    const lastPartIndex = publicIdParts.length - 1;
    publicIdParts[lastPartIndex] = publicIdParts[lastPartIndex].replace(path.extname(publicIdParts[lastPartIndex]), '');
    return publicIdParts.join('/');
  } catch {
    return null;
  }
};

const deleteCloudinaryImage = async (fileUrl) => {
  const publicId = getCloudinaryPublicId(fileUrl);
  if (!publicId) return false;

  const result = await cloudinary.uploader.destroy(publicId, {
    resource_type: 'image',
    invalidate: true,
  });

  return result.result === 'ok' || result.result === 'not found';
};

module.exports = {
  uploadImageBuffer,
  deleteCloudinaryImage,
  getCloudinaryPublicId,
  isCloudinaryConfigured,
};
