import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listWorkOrderEmailPhotos = vi.fn();
const createRepairLog = vi.fn();
const deleteMarkdownImage = vi.fn();
const uploadHandler = vi.fn();

vi.mock("@/lib/api/client", () => ({
  apiClient: {
    listWorkOrderEmailPhotos: (...args: unknown[]) => listWorkOrderEmailPhotos(...args),
    createRepairLog: (...args: unknown[]) => createRepairLog(...args),
    deleteMarkdownImage: (...args: unknown[]) => deleteMarkdownImage(...args)
  }
}));

vi.mock("@/components/work-notes-editor-config", () => ({
  markdownImageUploadHandler: (...args: unknown[]) => uploadHandler(...args)
}));

import { JobPhotosCard, photoLogMarkdown } from "@/components/job-photos-card";

function photo(id: string, source: string) {
  return {
    id, url: `https://storage.example/${id}.jpg`, name: `${id}.jpg`, source, original_bytes: 900_000, send_bytes: 300_000,
    original_type: "image/jpeg", width: 1600, height: 1200, supported: true
  };
}

function jpeg(name: string) {
  return new File(["x"], name, { type: "image/jpeg" });
}

beforeEach(() => {
  listWorkOrderEmailPhotos.mockResolvedValue({ items: [photo("a", "Problem"), photo("b", "Repair log Nov 5")], max_photos: 10, max_total_bytes: 15_000_000 });
  deleteMarkdownImage.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("JobPhotosCard", () => {
  it("lists the job's photos and opens a zoomable lightbox with next/previous", async () => {
    render(<JobPhotosCard referenceId={42} canView canAdd={false} refreshKey="1" />);
    expect(await screen.findByRole("button", { name: "Open photo 1 from Problem" })).toBeInTheDocument();
    expect(listWorkOrderEmailPhotos).toHaveBeenCalledWith(42);
    expect(screen.getByText("Job photos (2)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Take photo/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open photo 1 from Problem" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Photo 1 of 2 · Problem/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Zoom photo" }));
    expect(within(dialog).getByRole("button", { name: "Fit photo" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Next photo" }));
    expect(within(dialog).getByText(/Photo 2 of 2 · Repair log Nov 5/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Previous photo" }));
    expect(within(dialog).getByText(/Photo 1 of 2/)).toBeInTheDocument();
  });

  it("reloads when the refresh key changes", async () => {
    const { rerender } = render(<JobPhotosCard referenceId={42} canView canAdd={false} refreshKey="1" />);
    await waitFor(() => expect(listWorkOrderEmailPhotos).toHaveBeenCalledTimes(1));
    rerender(<JobPhotosCard referenceId={42} canView canAdd={false} refreshKey="2" />);
    await waitFor(() => expect(listWorkOrderEmailPhotos).toHaveBeenCalledTimes(2));
  });

  it("Take photo opens the rear camera and saves uploads as a new photo repair log", async () => {
    uploadHandler.mockImplementation((file: File) => Promise.resolve(`https://storage.example/markdown-temp/${file.name}`));
    createRepairLog.mockResolvedValue({});
    const onPhotosSaved = vi.fn();
    render(<JobPhotosCard referenceId={42} canView canAdd refreshKey="1" onPhotosSaved={onPhotosSaved} />);
    await screen.findByRole("button", { name: "Open photo 1 from Problem" });

    const camera = screen.getByTestId("job-photo-camera-input");
    expect(camera).toHaveAttribute("capture", "environment");
    expect(camera).toHaveAttribute("accept", "image/*");
    expect(screen.getByTestId("job-photo-library-input")).toHaveAttribute("multiple");
    expect(screen.getByRole("button", { name: /Take photo/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add photos/ })).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("job-photo-library-input"), { target: { files: [jpeg("one.jpg"), jpeg("two.jpg")] } });
    await waitFor(() => expect(createRepairLog).toHaveBeenCalledTimes(1));
    const [ref, payload] = createRepairLog.mock.calls[0];
    expect(ref).toBe(42);
    expect(payload.hours_used).toBe(0);
    expect(payload.repair_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(payload.details).toBe(
      photoLogMarkdown(["https://storage.example/markdown-temp/one.jpg", "https://storage.example/markdown-temp/two.jpg"])
    );
    await waitFor(() => expect(onPhotosSaved).toHaveBeenCalled());
    await waitFor(() => expect(listWorkOrderEmailPhotos).toHaveBeenCalledTimes(2));
  });

  it("removes the temporary uploads when the photo log can't be saved", async () => {
    uploadHandler.mockResolvedValue("https://storage.example/markdown-temp/one.jpg");
    createRepairLog.mockRejectedValue(new Error("forbidden"));
    render(<JobPhotosCard referenceId={42} canView={false} canAdd refreshKey="1" />);
    expect(listWorkOrderEmailPhotos).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId("job-photo-camera-input"), { target: { files: [jpeg("one.jpg")] } });
    expect(await screen.findByText("Couldn't save photos: forbidden")).toBeInTheDocument();
    expect(deleteMarkdownImage).toHaveBeenCalledWith("https://storage.example/markdown-temp/one.jpg");
  });

  it("renders nothing without view or add permission", () => {
    const { container } = render(<JobPhotosCard referenceId={42} canView={false} canAdd={false} refreshKey="1" />);
    expect(container).toBeEmptyDOMElement();
  });
});
