import type { PipelineContext, StepResult } from "../context";
import { generatedImages, designValidations } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { validateImage } from "@/lib/images/validator";
import { upscaleForPrint, postProcessForPrint } from "@/lib/images/upscaler";
import { uploadImageBuffer } from "@/lib/images/storage";

export default async function execute(context: PipelineContext): Promise<StepResult> {
  if (context.dryRun) {
    return { status: "completed", message: "Dry run: skipped validation" };
  }

  // Get generated images that need validation
  const images = context.generatedImageIds.length > 0
    ? await context.db.select().from(generatedImages).where(inArray(generatedImages.id, context.generatedImageIds)).all()
    : await context.db.select().from(generatedImages).where(eq(generatedImages.status, "generated")).all();

  if (images.length === 0) {
    return { status: "completed", message: "No images to validate" };
  }

  let passed = 0;
  let failed = 0;

  for (const image of images) {
    try {
      // Download from Vercel Blob
      const response = await fetch(image.storageUrl!);
      const rawBuffer = Buffer.from(await response.arrayBuffer());

      // Post-process: reduce AI artifacts
      const processedBuffer = await postProcessForPrint(rawBuffer);

      // Upscale to print-ready dimensions — uses Real-ESRGAN when REPLICATE_API_TOKEN
      // is set, falling back to sharp interpolation if it fails.
      const upscaled = await upscaleForPrint(processedBuffer, 4500, 5400, {
        sourceUrl: image.storageUrl ?? undefined,
      });

      // Upload the upscaled version back to Blob
      const stored = await uploadImageBuffer(
        upscaled.buffer,
        `designs/upscaled/${image.id}-print-ready.png`,
      );

      // Update image with upscaled URL
      await context.db.update(generatedImages).set({
        storageUrl: stored.url,
        storagePath: stored.pathname,
      }).where(eq(generatedImages.id, image.id));

      // Validate the upscaled image
      const validation = await validateImage(upscaled.buffer);

      // Record validation
      await context.db.insert(designValidations).values({
        generatedImageId: image.id,
        width: validation.details.width,
        height: validation.details.height,
        dpiValue: validation.details.dpi,
        format: validation.details.format,
        colorMode: validation.details.colorMode,
        fileSizeBytes: validation.details.fileSizeBytes,
        dimensionsPass: validation.checks.dimensions,
        dpiPass: validation.checks.dpi,
        formatPass: validation.checks.format,
        colorModePass: validation.checks.colorMode,
        fileSizePass: validation.checks.fileSize,
        overallPass: validation.passed,
        failureReasons: validation.failures.length > 0 ? JSON.stringify(validation.failures) : null,
      });

      // Update image status
      await context.db.update(generatedImages).set({
        status: validation.passed ? "validated" : "rejected",
      }).where(eq(generatedImages.id, image.id));

      if (validation.passed) {
        context.validatedImageIds.push(image.id);
        passed++;
      } else {
        failed++;
      }
    } catch (error) {
      // Validation error — reject the image
      await context.db.update(generatedImages).set({
        status: "rejected",
        errorMessage: error instanceof Error ? error.message : String(error),
      }).where(eq(generatedImages.id, image.id));
      failed++;
    }
  }

  return {
    status: "completed",
    message: `Validated ${images.length} images: ${passed} passed, ${failed} failed`,
    data: { total: images.length, passed, failed },
  };
}
