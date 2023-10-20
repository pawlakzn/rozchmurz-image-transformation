# Śląsknet images

## Installation

```bash
$ npm run install
```

### Mac M1
```
npm install
rm -rf node_modules/sharp
SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm install --arch=x64 --platform=linux --libc=glibc sharp
```

## Running the app

```bash
# development
$ npm run start:dev
```

