export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const MAX_STORED_LENGTH = 512 * 1024;
const STORAGE_PREFIX = 'finance_dashboard_avatar:v1:';

export function avatarStorageKey(userId: string): string {
    if (!userId) throw new Error('Sign in before updating a profile photo.');
    return STORAGE_PREFIX + encodeURIComponent(userId);
}

function isStoredImage(value: string): boolean {
    return value.length <= MAX_STORED_LENGTH && /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(value);
}

export function readAvatar(userId: string): string | null {
    const key = avatarStorageKey(userId);
    try {
        const value = localStorage.getItem(key);
        return value && isStoredImage(value) ? value : null;
    } catch {
        throw new Error('Profile photo storage is unavailable in this browser.');
    }
}

export function saveAvatar(userId: string, image: string): void {
    const key = avatarStorageKey(userId);
    if (!isStoredImage(image)) throw new Error('Unable to save this profile photo. Please choose another image.');
    try {
        localStorage.setItem(key, image);
    } catch {
        throw new Error('Could not save the photo. Browser storage may be full or blocked. Your previous photo was kept.');
    }
}

export function removeAvatar(userId: string): void {
    const key = avatarStorageKey(userId);
    try {
        localStorage.removeItem(key);
    } catch {
        throw new Error('Could not remove the photo because browser storage is unavailable. Please try again.');
    }
}

function imageFormat(bytes: Uint8Array): string | null {
    if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'image/png';
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
        && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
        && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) + 8 === bytes.length) return 'image/webp';
    return null;
}

interface DecodedImage {
    source: CanvasImageSource;
    width: number;
    height: number;
    release: () => void;
}

async function decodeImage(blob: Blob): Promise<DecodedImage> {
    if (typeof createImageBitmap === 'function') {
        const bitmap = await createImageBitmap(blob);
        return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    }
    const image = new Image();
    const url = URL.createObjectURL(blob);
    try {
        image.decoding = 'async';
        await new Promise<void>((resolve, reject) => {
            image.onload = () => resolve();
            image.onerror = () => reject(new Error('Image decoding failed.'));
            image.src = url;
        });
        return { source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(url) };
    } catch (error) {
        URL.revokeObjectURL(url);
        throw error;
    } finally {
        image.onload = null;
        image.onerror = null;
    }
}

/** Detect bytes and decode before normalizing to a bounded, metadata-free local PNG. */
export async function prepareAvatar(file: File): Promise<string> {
    if (file.size > MAX_AVATAR_BYTES) throw new Error('Choose an image no larger than 2 MB.');
    let buffer: ArrayBuffer;
    try {
        buffer = await file.arrayBuffer();
    } catch {
        throw new Error('The image could not be read. Please choose it again.');
    }
    if (buffer.byteLength > MAX_AVATAR_BYTES) throw new Error('Choose an image no larger than 2 MB.');
    const format = imageFormat(new Uint8Array(buffer));
    if (!format) throw new Error('Choose a JPEG, PNG or WebP image. The file contents must match a supported image format.');
    let image: DecodedImage;
    try {
        image = await decodeImage(new Blob([buffer], { type: format }));
    } catch {
        throw new Error('The image could not be decoded. Choose a valid JPEG, PNG or WebP image.');
    }
    try {
        if (!image.width || !image.height || image.width > 8192 || image.height > 8192 || image.width * image.height > 40_000_000) {
            throw new Error('Use an image up to 8192 pixels per side and 40 megapixels.');
        }
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 256;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Image processing is unavailable in this browser.');
        const side = Math.min(image.width, image.height);
        context.drawImage(image.source, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, 256, 256);
        const result = canvas.toDataURL('image/png');
        if (!isStoredImage(result)) throw new Error('Unable to prepare this photo. Please try another image.');
        return result;
    } finally {
        image.release();
    }
}
