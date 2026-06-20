import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { v4 as uuid } from 'uuid';

export function imageStorage(folder: 'products' | 'categories') {
  return diskStorage({
    destination: `./uploads/${folder}`,
    filename: (_req, file, cb) => {
      cb(null, `${uuid()}${extname(file.originalname)}`);
    },
  });
}

export function imageFileFilter(
  _req: unknown,
  file: Express.Multer.File,
  cb: (error: Error | null, acceptFile: boolean) => void,
) {
  if (!file.mimetype.match(/^image\/(jpeg|png|webp|gif)$/)) {
    return cb(
      new BadRequestException(
        'Only image files are allowed (jpeg, png, webp, gif)',
      ),
      false,
    );
  }
  cb(null, true);
}
