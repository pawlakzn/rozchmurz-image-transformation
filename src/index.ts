import { S3Event } from 'aws-lambda';
import { S3 } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import mime from 'mime-types';
import sharp, { Metadata } from 'sharp';
import path from 'path';
import { MAX_LENGTH, THUMBNAIL_HEIGHT, THUMBNAIL_WIDTH } from './constants/image.constants.js';
import { streamToBuffer } from './utils/stream-to-buffer.js';

const COMPRESSED_BUCKET = process.env.COMPRESSED_BUCKET;
const UNCOMPRESSED_BUCKET = process.env.UNCOMPRESSED_BUCKET;

const s3 = new S3();

export const handler = async (event: S3Event): Promise<void> => {
    event.Records.map((record) => console.log(record.s3.object));
    const files = event.Records.map((record) => record.s3.object);

    await Promise.all(
        files.map(async (object) => {
            const { key } = object;

            try {
                const { Body } = await s3.getObject({
                    Key: key,
                    Bucket: UNCOMPRESSED_BUCKET,
                });

                if (Body) {
                    const bodyContents = await streamToBuffer(Body as Readable);
                    const meta = await sharp(bodyContents).metadata();

                    const { TagSet } = await s3.getObjectTagging({
                        Key: key,
                        Bucket: UNCOMPRESSED_BUCKET,
                    });

                    await compress(key, bodyContents, meta);

                    const shouldCreateThumbnail = TagSet?.find(
                        (tag) => tag.Key === 'shouldCreateThumbnail',
                    )?.Value;

                    if (shouldCreateThumbnail === 'true') {
                        await createThumbnail(key, bodyContents, meta.width, meta.height);
                    }
                }
            } catch (error) {
                console.error(error);
            }
        }),
    );
};

const compress = async (s3Key: string, buffer: Buffer, meta: Metadata): Promise<void> => {
    const compressedBuffer = await resizeIfTooBig(buffer, meta);
    const mimeType = meta?.format ? mime.lookup(meta?.format) : false;

    await s3.putObject({
        Bucket: COMPRESSED_BUCKET,
        Key: s3Key,
        Body: compressedBuffer,
        ContentType: mimeType ? mimeType : undefined,
        ACL: 'public-read',
    });
};

const resizeIfTooBig = async (buffer: Buffer, meta: Metadata): Promise<Buffer> => {
    if (!meta.width || !meta.height) {
        return buffer;
    }

    if (meta.width < MAX_LENGTH && meta.height < MAX_LENGTH) {
        return buffer;
    }

    let newWidth: number | undefined = MAX_LENGTH;
    let newHeight: number | undefined = MAX_LENGTH;

    if (meta.width > MAX_LENGTH) {
        newHeight = undefined;
    } else {
        newWidth = undefined;
    }

    return sharp(buffer).resize(newWidth, newHeight).toBuffer();
};

const createThumbnail = async (
    s3Key: string,
    buffer: Buffer,
    originalWidth?: number,
    originalHeight?: number,
): Promise<void> => {
    if (!originalWidth || !originalHeight) {
        return;
    }

    if (originalWidth < THUMBNAIL_WIDTH && originalHeight < THUMBNAIL_HEIGHT) {
        return;
    }

    let thumbnailWidth: number | undefined = THUMBNAIL_WIDTH;
    let thumbnailHeight: number | undefined = THUMBNAIL_HEIGHT;

    if (originalWidth > THUMBNAIL_WIDTH) {
        thumbnailHeight = undefined;
    } else {
        thumbnailWidth = undefined;
    }

    const thumbnailBuffer = await sharp(buffer).resize(thumbnailWidth, thumbnailHeight).toBuffer();
    const meta = await sharp(thumbnailBuffer).metadata();
    const mimeType = meta?.format ? mime.lookup(meta?.format) : undefined;
    const { ext, name } = path.parse(s3Key);

    await s3.putObject({
        Bucket: COMPRESSED_BUCKET,
        Key: `${name}_thumbnail.${ext}`,
        Body: thumbnailBuffer,
        ContentType: mimeType ? mimeType : undefined,
        Tagging: `shouldCreateThumbnail=false&isThumbnail=true`,
        ACL: 'public-read',
    });
};
