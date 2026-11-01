import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import AnimatedModal from '../../components/ui/AnimatedModal';
import { ACCEPTED_IMAGE_TYPES, formatFileSize, uploadImageAsset, validateImageFile } from './imageAssets.js';

const STATUS_LABEL = {
  invalid: 'Not uploaded',
  queued: 'Waiting',
  uploading: 'Uploading',
  placing: 'Placing on board',
  placed: 'Added to board',
  failed: 'Upload failed'
};

let nextItemId = 0;

export const ImageUploadDialog = ({ isOpen, onClose, onUploaded }) => {
  const { id: boardId } = useParams();
  const [items, setItems] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef(null);
  const itemsRef = useRef(items);
  const processingRef = useRef(false);
  itemsRef.current = items;

  const updateItem = (id, changes) => setItems((current) => current.map((item) => (item.id === id ? { ...item, ...changes } : item)));

  useEffect(() => () => itemsRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl)), []);

  const processQueue = async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      let next = itemsRef.current.find((item) => item.status === 'queued');
      while (next) {
        const { id, file } = next;
        updateItem(id, { status: 'uploading', progress: 0 });
        itemsRef.current = itemsRef.current.map((item) => (item.id === id ? { ...item, status: 'uploading' } : item));
        try {
          const asset = await uploadImageAsset({ file, boardId, onProgress: (progress) => updateItem(id, { progress }) });
          updateItem(id, { status: 'placing', progress: 1 });
          try {
            await onUploaded(asset);
            updateItem(id, { status: 'placed' });
          } catch {
            updateItem(id, { status: 'failed', error: 'The image was uploaded but could not be displayed on the board.' });
          }
        } catch (err) {
          updateItem(id, { status: 'failed', error: err?.message || 'The upload failed. Please try again.' });
        }
        next = itemsRef.current.find((item) => item.status === 'queued');
      }
    } finally {
      processingRef.current = false;
    }
  };

  const addFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    const checked = await Promise.all(files.map(async (file) => {
      const result = await validateImageFile(file);
      return {
        id: `upload_${nextItemId += 1}`,
        file,
        previewUrl: result.ok ? URL.createObjectURL(file) : '',
        status: result.ok ? 'queued' : 'invalid',
        progress: 0,
        error: result.ok ? '' : result.error
      };
    }));
    itemsRef.current = [...itemsRef.current, ...checked];
    setItems((current) => [...current, ...checked]);
    processQueue();
  };

  const handleClose = () => {
    const isActive = (item) => item.status === 'queued' || item.status === 'uploading' || item.status === 'placing';
    items.filter((item) => !isActive(item)).forEach((item) => URL.revokeObjectURL(item.previewUrl));
    itemsRef.current = itemsRef.current.filter(isActive);
    setItems((current) => current.filter(isActive));
    onClose();
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setIsDragging(false);
    addFiles(event.dataTransfer?.files);
  };

  return (
    <AnimatedModal isOpen={isOpen} onClose={handleClose} title="Upload Image">
      <div className="flex flex-col gap-4">
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${isDragging ? 'border-primary bg-primary-container' : 'border-outline-variant bg-surface-container-low'}`}
        >
          <span className="material-symbols-outlined text-4xl text-primary" aria-hidden="true">upload_file</span>
          <p className="font-bold text-on-surface">Drop images here</p>
          <p className="text-sm text-on-surface-variant">PNG, JPG or WebP, up to 5 MB each</p>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="mt-2 rounded-full bg-primary px-5 py-2 font-bold text-on-primary transition-transform hover:scale-105 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Browse files
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES}
            multiple
            className="hidden"
            aria-label="Choose images to upload"
            onChange={(event) => {
              addFiles(event.target.files);
              event.target.value = '';
            }}
          />
        </div>

        {items.length > 0 && (
          <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto" aria-live="polite">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-3 rounded-xl border border-outline-variant bg-surface-container-low p-2">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-container">
                  {item.previewUrl
                    ? <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                    : <span className="material-symbols-outlined text-error" aria-hidden="true">block</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-sm font-bold text-on-surface" title={item.file.name}>{item.file.name}</p>
                    <span className="shrink-0 text-xs text-on-surface-variant">{formatFileSize(item.file.size)}</span>
                  </div>
                  {item.status === 'uploading' || item.status === 'placing' ? (
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-container" role="progressbar" aria-label={`Uploading ${item.file.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(item.progress * 100)}>
                      <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.round(item.progress * 100)}%` }} />
                    </div>
                  ) : null}
                  <p className={`mt-0.5 text-xs ${item.error ? 'text-error' : 'text-on-surface-variant'}`}>
                    {item.error || STATUS_LABEL[item.status]}
                  </p>
                </div>
                {item.status === 'placed' && <span className="material-symbols-outlined text-primary" aria-hidden="true">check_circle</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </AnimatedModal>
  );
};

export default ImageUploadDialog;
